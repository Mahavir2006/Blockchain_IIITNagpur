import { ethers } from "hardhat";

export const U = (n: number | string) => ethers.parseEther(String(n));
export const WATER = ethers.encodeBytes32String("water-infrastructure");
export const RELIEF = ethers.encodeBytes32String("relief-kits");
export const STATE = { SUBMITTED: 0n, VENDOR_ATTESTED: 1n, QUORUM_VERIFIED: 2n, CHALLENGED: 3n, REJECTED: 4n };

/**
 * Full, wired system: 3 admitted and bonded verifiers (bootstrap closed), a registered vendor
 * and two campaigns (#1 water, #2 relief) owned by `ngo`.
 */
export async function deploySystem() {
  const [admin, ngo, donor, donor2, vendor, offramp, v1, v2, v3, stranger] = await ethers.getSigners();
  const F = (n: string) => ethers.getContractFactory(n);
  const musd: any = await (await F("MockUSD")).deploy();
  const wusd: any = await (await F("MockUSD")).deploy();
  const registry: any = await (await F("ParticipantRegistry")).deploy();
  const freeze: any = await (await F("FreezeController")).deploy(await registry.getAddress());
  const impact: any = await (await F("ImpactVerifier")).deploy();
  const escrow: any = await (await F("CampaignEscrow")).deploy(await musd.getAddress(), await freeze.getAddress(), await impact.getAddress());
  const evidence: any = await (await F("EvidenceRegistry")).deploy();
  const attest: any = await (await F("AttestationVerifier")).deploy(await registry.getAddress(), 2, 2);
  const swap: any = await (await F("MockSwap")).deploy(1, 1);
  const bridge: any = await (await F("BridgeGateway")).deploy();
  const fiat: any = await (await F("FiatOffRampAttestor")).deploy();

  // One-time wiring between the contracts.
  await impact.setEscrow(await escrow.getAddress());
  await evidence.setEscrow(await escrow.getAddress());
  await attest.setEvidenceRegistry(await evidence.getAddress());
  await escrow.setAttestationVerifier(await attest.getAddress());

  await registry.setBondToken(await musd.getAddress());
  await freeze.setRequiredUnfreezeVotes(2);
  await wusd.mint(await swap.getAddress(), U(1000));
  await fiat.registerPartner(offramp.address);
  for (const v of [v1, v2, v3]) {
    await musd.mint(v.address, U(10));
    await registry.connect(v).registerVerifier();
    await registry.admitVerifier(v.address);
    await musd.connect(v).approve(await registry.getAddress(), U(10));
    await registry.connect(v).stakeBond(U(10));
  }
  await registry.closeBootstrap();
  await registry.connect(vendor).registerVendor(vendor.address);

  const now = (await ethers.provider.getBlock("latest"))!.timestamp;
  const expiry = now + 30 * 86400;
  await escrow.connect(ngo).createCampaign(WATER, U(100), expiry, [U(20), U(30)], [75, 75]);
  await escrow.connect(ngo).createCampaign(RELIEF, U(100), expiry, [U(20)], [75]);

  for (const [d, amt] of [[donor, 50], [donor2, 25]] as const) {
    await musd.mint(d.address, U(amt));
    await musd.connect(d).approve(await escrow.getAddress(), U(amt));
  }

  const chainId = (await ethers.provider.getNetwork()).chainId;
  const domain = { name: "BlackHoleLedger", version: "1", chainId, verifyingContract: await attest.getAddress() };
  const types = {
    VendorAttestation: [
      { name: "evidenceId", type: "uint256" },
      { name: "vendor", type: "address" },
      { name: "amount", type: "uint256" },
      { name: "commitment", type: "bytes32" },
      { name: "nonce", type: "uint256" },
    ],
  };

  /** Off-chain formulas from docs/PHASE0-formulas.md. */
  const makeEvidence = (label: string, amount: bigint, category = WATER, date = BigInt(now)) => {
    const invoiceHash = ethers.keccak256(ethers.toUtf8Bytes(label));
    const salt = ethers.hexlify(ethers.randomBytes(32));
    const commitment = ethers.solidityPackedKeccak256(
      ["bytes32", "bytes32", "address", "uint256", "bytes32", "uint256"],
      [salt, invoiceHash, vendor.address, amount, category, date],
    );
    const nullifier = ethers.solidityPackedKeccak256(["bytes32", "address", "uint256", "uint256"], [invoiceHash, vendor.address, amount, date]);
    return { invoiceHash, salt, commitment, nullifier, amount, category, date };
  };

  const submit = async (campaignId: number, e: ReturnType<typeof makeEvidence>, from = ngo) => {
    const id = await evidence.nextEvidenceId();
    await evidence.connect(from).submitEvidence(campaignId, e.commitment, e.nullifier, e.invoiceHash, vendor.address, e.amount, e.category, e.date, e.salt);
    return id as bigint;
  };

  const vendorSign = async (signer: any, evidenceId: bigint, amount: bigint, commitment: string, nonce = 0) =>
    ethers.Signature.from(await signer.signTypedData(domain, types, { evidenceId, vendor: vendor.address, amount, commitment, nonce }));

  /** Two verifier votes reach the freeze quorum. */
  const freezeNow = async (campaignId: number, reason: number) => {
    await freeze.connect(v1).triggerFreeze(campaignId, reason);
    await freeze.connect(v2).triggerFreeze(campaignId, reason);
  };

  /** Submits evidence for `amount`, gets the vendor signature and a 2-verifier quorum. */
  let evidenceSeq = 0;
  const verifyEvidence = async (campaignId: number, amount: bigint) => {
    const e = makeEvidence(`AUTO-${campaignId}-${evidenceSeq++}`, amount);
    const id = await submit(campaignId, e);
    const sig = await vendorSign(vendor, id, e.amount, e.commitment);
    await attest.connect(vendor).vendorAttest(id, e.amount, e.commitment, sig.v, sig.r, sig.s, 0);
    await attest.connect(v1).verifierAttest(id);
    await attest.connect(v2).verifierAttest(id);
    return id;
  };

  /** A registered off-ramp partner's EIP-191 signature over a settlement statement. */
  const fiatSign = async (signer: any, hopId: string, amount: bigint, asset: string) =>
    ethers.Signature.from(await signer.signMessage(ethers.getBytes(await fiat.settlementHash(hopId, amount, asset))));

  return { freezeNow, verifyEvidence, fiatSign, admin, ngo, donor, donor2, vendor, offramp, v1, v2, v3, stranger, musd, wusd, registry, freeze, impact, escrow, evidence, attest, swap, bridge, fiat, expiry, makeEvidence, submit, vendorSign };
}
