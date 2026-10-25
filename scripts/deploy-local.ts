/**
 * Deploys, wires and seeds the protocol on a running node, then writes the addresses to
 * deployments/<network>.json for the API server.
 *
 *   npx hardhat run scripts/deploy-local.ts --network localhost
 *
 * Every number the dashboard shows afterwards comes from these on-chain transactions; only
 * human-readable labels (campaign names, regions, vendor names) are kept off-chain in the JSON.
 *
 * Account roles (Hardhat default accounts):
 *   0 admin · 1/9/10 NGOs · 2/3 donors · 4/11/12 vendors · 5 off-ramp partner · 6/7/8 verifiers
 */
import { ethers, network } from "hardhat";
import * as fs from "fs";
import * as path from "path";

const U = (n: number | string) => ethers.parseEther(String(n));
const CHAIN_B = 31338n;
const ACCOUNTS = { admin: 0, ngoA: 1, donor: 2, donor2: 3, vendorA: 4, offramp: 5, v1: 6, v2: 7, v3: 8, ngoB: 9, ngoC: 10, vendorB: 11, vendorC: 12 };

const pair = (a: string, b: string) =>
  a.toLowerCase() <= b.toLowerCase() ? ethers.keccak256(ethers.concat(["0x01", a, b])) : ethers.keccak256(ethers.concat(["0x01", b, a]));

/** Domain-separated Merkle root, same rules as MerkleLib. */
function merkleRoot(leaves: string[]) {
  let level = leaves.map((l) => ethers.keccak256(ethers.concat(["0x00", l])));
  while (level.length > 1) {
    const next: string[] = [];
    for (let i = 0; i < level.length; i += 2) next.push(i + 1 < level.length ? pair(level[i], level[i + 1]) : level[i]);
    level = next;
  }
  return level[0];
}

async function main() {
  const signers = await ethers.getSigners();
  const s = Object.fromEntries(Object.entries(ACCOUNTS).map(([k, i]) => [k, signers[i]])) as Record<keyof typeof ACCOUNTS, (typeof signers)[number]>;
  const startBlock = await ethers.provider.getBlockNumber();
  const chainId = (await ethers.provider.getNetwork()).chainId;
  console.log(`Deploying to ${network.name} (chain ${chainId}) from block ${startBlock}`);

  // ---------- Deploy
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

  // ---------- Wire (one-time)
  await impact.setEscrow(await escrow.getAddress());
  await evidence.setEscrow(await escrow.getAddress());
  await attest.setEvidenceRegistry(await evidence.getAddress());
  await escrow.setAttestationVerifier(await attest.getAddress());
  await registry.setBondToken(await musd.getAddress());
  await freeze.setRequiredUnfreezeVotes(2);
  await wusd.mint(await swap.getAddress(), U(100000));
  await fiat.registerPartner(s.offramp.address);

  // ---------- Participants
  for (const v of [s.v1, s.v2, s.v3]) {
    await musd.mint(v.address, U(25));
    await registry.connect(v).registerVerifier();
    await registry.admitVerifier(v.address);
    await musd.connect(v).approve(await registry.getAddress(), U(25));
    await registry.connect(v).stakeBond(U(25));
  }
  await registry.closeBootstrap();
  for (const n of [s.ngoA, s.ngoB, s.ngoC]) await registry.connect(n).registerNGO();
  for (const v of [s.vendorA, s.vendorB, s.vendorC]) await registry.connect(v).registerVendor(v.address);
  for (const d of [s.donor, s.donor2]) {
    await musd.mint(d.address, U(10000));
    await musd.connect(d).approve(await escrow.getAddress(), ethers.MaxUint256);
  }

  // ---------- Campaigns
  const expiry = (await ethers.provider.getBlock("latest"))!.timestamp + 90 * 86400;
  const campaigns = [
    { ngo: s.ngoA, name: "Clean Water for Wardha District", org: "Jal Seva Trust", region: "Maharashtra, IN", category: "Water infrastructure", target: 120, tranches: [30, 40, 50] },
    { ngo: s.ngoB, name: "Flood Relief Kits — Assam", org: "Brightway Relief Foundation", region: "Assam, IN", category: "Relief kits", target: 80, tranches: [20, 30, 30] },
    { ngo: s.ngoC, name: "School Meals — Nagpur Rural", org: "Annapurna Collective", region: "Maharashtra, IN", category: "Food procurement", target: 60, tranches: [20, 40] },
  ];
  for (const c of campaigns) {
    await escrow.connect(c.ngo).createCampaign(ethers.encodeBytes32String(c.category), U(c.target), expiry, c.tranches.map(U), c.tranches.map(() => 1));
  }

  // ---------- Helpers
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
  let seq = 0;
  /** NGO files a receipt; optionally the vendor signs it and `approvals` verifiers attest. */
  const receipt = async (campaignId: number, vendor: any, amount: number, opts: { vendorSigns?: boolean; approvals?: number } = {}) => {
    const c = campaigns[campaignId - 1];
    const amt = U(amount);
    const invoiceHash = ethers.keccak256(ethers.toUtf8Bytes(`SEED-INV-${campaignId}-${seq++}`));
    const date = BigInt((await ethers.provider.getBlock("latest"))!.timestamp);
    const salt = ethers.hexlify(ethers.randomBytes(32));
    const category = ethers.encodeBytes32String(c.category);
    const commitment = ethers.solidityPackedKeccak256(["bytes32", "bytes32", "address", "uint256", "bytes32", "uint256"], [salt, invoiceHash, vendor.address, amt, category, date]);
    const nullifier = ethers.solidityPackedKeccak256(["bytes32", "address", "uint256", "uint256"], [invoiceHash, vendor.address, amt, date]);
    const id = await evidence.nextEvidenceId();
    await evidence.connect(c.ngo).submitEvidence(campaignId, commitment, nullifier, invoiceHash, vendor.address, amt, category, date, salt);
    if (opts.vendorSigns !== false) {
      const sig = ethers.Signature.from(await vendor.signTypedData(domain, types, { evidenceId: id, vendor: vendor.address, amount: amt, commitment, nonce: 0 }));
      await attest.connect(vendor).vendorAttest(id, amt, commitment, sig.v, sig.r, sig.s, 0);
    }
    for (const v of [s.v1, s.v2, s.v3].slice(0, opts.approvals ?? 2)) await attest.connect(v).verifierAttest(id);
    return id as bigint;
  };
  const deliveryRoot = (tag: string, n: number) => merkleRoot(Array.from({ length: n }, (_, i) => ethers.id(`${tag}-beneficiary-${i}|delivery`)));

  // ---------- Campaign 1: donations, verified spend, released tranche, full hop trail, one pending receipt
  await escrow.connect(s.donor).deposit(1, U(50));
  await escrow.connect(s.donor2).deposit(1, U(36));
  await receipt(1, s.vendorA, 30);
  await impact.connect(s.ngoA).publishDeliveryRoot(1, deliveryRoot("wardha", 66));
  await escrow.connect(s.ngoA).requestTrancheRelease(1, 0);
  await musd.connect(s.ngoA).approve(await swap.getAddress(), U(30));
  const swapTx = await swap.connect(s.ngoA).swap(await musd.getAddress(), await wusd.getAddress(), U(30));
  await wusd.connect(s.ngoA).approve(await bridge.getAddress(), U(30));
  const lockTx = await bridge.connect(s.ngoA).lock(await wusd.getAddress(), U(30), CHAIN_B, s.offramp.address);
  const lockRc = await lockTx.wait();
  const lockEv = lockRc.logs.map((l: any) => { try { return bridge.interface.parseLog(l); } catch { return null; } }).find((e: any) => e?.name === "AssetLocked");
  const messageId: string = lockEv.args.messageId;
  const mintTx = await bridge.mint(await wusd.getAddress(), U(30), s.offramp.address, CHAIN_B, messageId);
  const settle = ethers.Signature.from(await s.offramp.signMessage(ethers.getBytes(await fiat.settlementHash(messageId, U(30), await wusd.getAddress()))));
  const fiatTx = await fiat.attestFiatSettlement(messageId, U(30), await wusd.getAddress(), settle.v, settle.r, settle.s);
  await receipt(1, s.vendorA, 12, { approvals: 1 });

  // ---------- Campaign 2: released tranche, then a forged receipt rejected and the campaign frozen
  await escrow.connect(s.donor).deposit(2, U(40));
  await escrow.connect(s.donor2).deposit(2, U(24));
  await receipt(2, s.vendorB, 20);
  await impact.connect(s.ngoB).publishDeliveryRoot(2, deliveryRoot("assam", 40));
  await escrow.connect(s.ngoB).requestTrancheRelease(2, 0);
  const forged = await receipt(2, s.vendorB, 10, { vendorSigns: false, approvals: 0 });
  await attest.connect(s.v1).verifierChallenge(forged);
  await attest.resolveChallenge(forged, true);
  await freeze.connect(s.v1).triggerFreeze(2, 2);
  await freeze.connect(s.v2).triggerFreeze(2, 2);
  await freeze.connect(s.v3).voteUnfreeze(2); // one of the two votes needed to lift it

  // ---------- Campaign 3: partly verified spend, first tranche still waiting on evidence
  await escrow.connect(s.donor).deposit(3, U(41));
  await receipt(3, s.vendorC, 15);
  await receipt(3, s.vendorC, 9, { approvals: 1 });
  await impact.connect(s.ngoC).publishDeliveryRoot(3, deliveryRoot("nagpur", 120));

  // ---------- Write deployment file
  const out = {
    network: network.name,
    chainId: Number(chainId),
    startBlock,
    deployedAt: new Date().toISOString(),
    accounts: ACCOUNTS,
    contracts: {
      MockUSD: await musd.getAddress(),
      WrappedUSD: await wusd.getAddress(),
      ParticipantRegistry: await registry.getAddress(),
      FreezeController: await freeze.getAddress(),
      ImpactVerifier: await impact.getAddress(),
      CampaignEscrow: await escrow.getAddress(),
      EvidenceRegistry: await evidence.getAddress(),
      AttestationVerifier: await attest.getAddress(),
      MockSwap: await swap.getAddress(),
      BridgeGateway: await bridge.getAddress(),
      FiatOffRampAttestor: await fiat.getAddress(),
    },
    // Off-chain labels only; all amounts and states are read from the chain.
    campaigns: Object.fromEntries(campaigns.map((c, i) => [i + 1, { name: c.name, org: c.org, region: c.region }])),
    names: {
      [s.donor.address]: "Donor A",
      [s.donor2.address]: "Donor B",
      [s.vendorA.address]: "Godavari Pumps Pvt Ltd",
      [s.vendorB.address]: "NE Supplies",
      [s.vendorC.address]: "Kisan Grain Mandi",
      [s.offramp.address]: "Off-ramp partner",
      [s.ngoA.address]: "Jal Seva Trust",
      [s.ngoB.address]: "Brightway Relief Foundation",
      [s.ngoC.address]: "Annapurna Collective",
      [s.v1.address]: "Verifier 1",
      [s.v2.address]: "Verifier 2",
      [s.v3.address]: "Verifier 3",
    },
    // Which campaign each cross-chain hop belongs to (hop events carry no campaign id).
    hops: [{ campaignId: 1, messageId, swapTx: swapTx.hash, lockTx: lockTx.hash, mintTx: mintTx.hash, fiatTx: fiatTx.hash }],
  };
  const file = path.join(__dirname, "..", "deployments", `${network.name}.json`);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(out, null, 2) + "\n");
  console.log(`Escrow ${out.contracts.CampaignEscrow}`);
  console.log(`Wrote ${file}`);
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
