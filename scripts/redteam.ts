/**
 * Red-team scenario (build spec §D). Runs end to end against one Hardhat network:
 *   npx hardhat run scripts/redteam.ts                 (in-process network)
 *   npx hardhat run scripts/redteam.ts --network localhost
 *
 * Honest scope notes:
 * - "Chain B" is simulated: a single BridgeGateway handles lock + mint on the same
 *   network, keyed by destination chain id 31338. No second node is required.
 * - The off-chain detection rules (duplicate nullifier, forged ratio) run in this
 *   script; two independent verifiers then vote FreezeController.triggerFreeze with the
 *   matching reason. A freeze needs that quorum: no single account can freeze or unfreeze.
 */
import { ethers } from "hardhat";
import * as fs from "fs";
import * as path from "path";

const U = (n: number | string) => ethers.parseEther(String(n));
const CHAIN_B = 31338n;
const STATE = ["Submitted", "VendorAttested", "QuorumVerified", "Challenged", "Rejected"];

const log: string[] = [];
function say(line = "") {
  console.log(line);
  log.push(line);
}

// Same domain-separated hashing as MerkleLib: 0x00 prefix for leaves, 0x01 for nodes.
function pair(a: string, b: string) {
  return a.toLowerCase() <= b.toLowerCase()
    ? ethers.keccak256(ethers.concat(["0x01", a, b]))
    : ethers.keccak256(ethers.concat(["0x01", b, a]));
}

function merkle(leaves: string[]) {
  let level = leaves.map((l) => ethers.keccak256(ethers.concat(["0x00", l])));
  const layers = [level];
  while (level.length > 1) {
    const next: string[] = [];
    for (let i = 0; i < level.length; i += 2) next.push(i + 1 < level.length ? pair(level[i], level[i + 1]) : level[i]);
    level = next;
    layers.push(level);
  }
  const proof = (idx: number) => {
    const out: string[] = [];
    for (const layer of layers.slice(0, -1)) {
      const sib = idx ^ 1;
      if (sib < layer.length) out.push(layer[sib]);
      idx >>= 1;
    }
    return out;
  };
  return { root: level[0], proof };
}

async function expectRevert(p: Promise<unknown>, reason: string) {
  try {
    await p;
  } catch (e) {
    const msg = (e as Error).message;
    if (msg.includes(reason)) return true;
    throw e;
  }
  throw new Error(`expected revert ${reason}`);
}

async function main() {
  const [admin, ngo, donor, donor2, vendor, offramp, v1, v2, v3, forger] = await ethers.getSigners();
  const net = await ethers.provider.getNetwork();
  say(`# Black Hole Ledger — red-team report`);
  say(``);
  say(`Network chainId ${net.chainId}; generated ${new Date().toISOString()}`);
  say(``);

  // ---------- Deploy ----------
  const F = (n: string) => ethers.getContractFactory(n);
  const musd = await (await F("MockUSD")).deploy();
  const wusd = await (await F("MockUSD")).deploy();
  const registry = await (await F("ParticipantRegistry")).deploy();
  const freeze = await (await F("FreezeController")).deploy(await registry.getAddress());
  const impact = await (await F("ImpactVerifier")).deploy();
  const escrow = await (await F("CampaignEscrow")).deploy(await musd.getAddress(), await freeze.getAddress(), await impact.getAddress());
  const evidence = await (await F("EvidenceRegistry")).deploy();
  const attest = await (await F("AttestationVerifier")).deploy(await registry.getAddress(), 2, 2);
  const swap = await (await F("MockSwap")).deploy(1, 1);
  const bridge = await (await F("BridgeGateway")).deploy();
  const fiat = await (await F("FiatOffRampAttestor")).deploy();

  // One-time wiring; none of these links can be changed afterwards.
  await impact.setEscrow(await escrow.getAddress());
  await evidence.setEscrow(await escrow.getAddress());
  await attest.setEvidenceRegistry(await evidence.getAddress());
  await escrow.setAttestationVerifier(await attest.getAddress());

  await registry.setBondToken(await musd.getAddress());
  await freeze.setRequiredUnfreezeVotes(2);
  await wusd.mint(await swap.getAddress(), U(1000));
  await fiat.registerPartner(offramp.address);
  say(`## 0. Setup`);
  say(`- Contracts deployed: escrow ${await escrow.getAddress()}, freeze ${await freeze.getAddress()}`);

  for (const v of [v1, v2, v3]) {
    await musd.mint(v.address, U(10));
    await registry.connect(v).registerVerifier();
    await registry.admitVerifier(v.address);
    await musd.connect(v).approve(await registry.getAddress(), U(10));
    await registry.connect(v).stakeBond(U(10));
  }
  await registry.closeBootstrap();
  await registry.connect(vendor).registerVendor(vendor.address);
  say(`- 3 verifiers admitted during bootstrap (now closed) and bonded at the 10 mUSD minimum; vendor registered with its own signing key`);

  const WATER = ethers.encodeBytes32String("water-infrastructure");
  const RELIEF = ethers.encodeBytes32String("relief-kits");
  const expiry = (await ethers.provider.getBlock("latest"))!.timestamp + 30 * 86400;
  await escrow.connect(ngo).createCampaign(WATER, U(100), expiry, [U(20), U(30)], [75, 75]);
  await escrow.connect(ngo).createCampaign(RELIEF, U(100), expiry, [U(20)], [75]);
  say(`- Campaign #1 "water infrastructure" and campaign #2 "relief kits" created by the NGO`);
  say(``);

  // ---------- 1. Donation ----------
  await musd.mint(donor.address, U(50));
  await musd.connect(donor).approve(await escrow.getAddress(), U(50));
  const dep = await escrow.connect(donor).deposit(1, U(50));
  await musd.mint(donor2.address, U(25));
  await musd.connect(donor2).approve(await escrow.getAddress(), U(25));
  await escrow.connect(donor2).deposit(2, U(25));
  say(`## 1. Donation`);
  say(`- Donor deposited 50 mUSD into campaign #1 (tx ${dep.hash})`);
  say(`- Second donor deposited 25 mUSD into campaign #2`);
  say(``);

  // ---------- 3. Honest tranche ----------
  say(`## 2–3. Honest tranche`);
  const invoiceHash = ethers.keccak256(ethers.toUtf8Bytes("INV-2026-0042 Godavari Pumps 4x borewell pumps"));
  const date = BigInt(expiry - 29 * 86400);
  const amount = U(20);
  const salt = ethers.hexlify(ethers.randomBytes(32));
  const commitment = ethers.solidityPackedKeccak256(
    ["bytes32", "bytes32", "address", "uint256", "bytes32", "uint256"],
    [salt, invoiceHash, vendor.address, amount, WATER, date],
  );
  const nullifier = ethers.solidityPackedKeccak256(["bytes32", "address", "uint256", "uint256"], [invoiceHash, vendor.address, amount, date]);
  await evidence.connect(ngo).submitEvidence(1, commitment, nullifier, invoiceHash, vendor.address, amount, WATER, date, salt);
  const honestId = 1n;

  const domain = { name: "BlackHoleLedger", version: "1", chainId: net.chainId, verifyingContract: await attest.getAddress() };
  const types = {
    VendorAttestation: [
      { name: "evidenceId", type: "uint256" },
      { name: "vendor", type: "address" },
      { name: "amount", type: "uint256" },
      { name: "commitment", type: "bytes32" },
      { name: "nonce", type: "uint256" },
    ],
  };
  const sig = ethers.Signature.from(await vendor.signTypedData(domain, types, { evidenceId: honestId, vendor: vendor.address, amount, commitment, nonce: 0 }));
  await attest.connect(vendor).vendorAttest(honestId, amount, commitment, sig.v, sig.r, sig.s, 0);
  await attest.connect(v1).verifierAttest(honestId);
  await attest.connect(v2).verifierAttest(honestId);
  say(`- Evidence #1 submitted (nullifier ${nullifier.slice(0, 18)}…), vendor EIP-712 signature valid`);
  say(`- Verifier quorum: ${await attest.getAttestationCount(honestId)}/2 → state ${STATE[Number(await attest.getEvidenceState(honestId))]}`);

  const deliveries = ["asha|pump-01", "bilal|pump-02", "chitra|pump-03", "dev|pump-04"].map((s) => ethers.keccak256(ethers.toUtf8Bytes(s)));
  const tree = merkle(deliveries);
  await impact.connect(ngo).publishDeliveryRoot(1, tree.root);
  const ok = await impact.verifyDelivery(1, deliveries[2], tree.proof(2));
  say(`- Delivery root ${tree.root.slice(0, 18)}… published; beneficiary 3 inclusion proof verifies: ${ok}`);

  const rel = await escrow.connect(ngo).requestTrancheRelease(1, 0);
  say(`- Tranche 0 (20 mUSD) released to NGO (tx ${rel.hash})`);

  // Money trail for the released tranche: swap → bridge → off-ramp to vendor.
  await musd.connect(ngo).approve(await swap.getAddress(), U(20));
  await swap.connect(ngo).swap(await musd.getAddress(), await wusd.getAddress(), U(20));
  await wusd.connect(ngo).approve(await bridge.getAddress(), U(20));
  const lockTx = await bridge.connect(ngo).lock(await wusd.getAddress(), U(20), CHAIN_B, offramp.address);
  const lockRc = await lockTx.wait();
  const lockEv = lockRc!.logs.map((l) => { try { return bridge.interface.parseLog(l); } catch { return null; } }).find((e) => e?.name === "AssetLocked");
  const messageId = lockEv!.args.messageId as string;
  await bridge.connect(admin).mint(await wusd.getAddress(), U(20), offramp.address, CHAIN_B, messageId);
  const settlement = ethers.Signature.from(
    await offramp.signMessage(ethers.getBytes(await fiat.settlementHash(messageId, U(20), await wusd.getAddress()))),
  );
  await fiat.attestFiatSettlement(messageId, U(20), await wusd.getAddress(), settlement.v, settlement.r, settlement.s);
  say(`- Hop trail: swap 20 mUSD→wUSD → bridge lock/mint (message ${messageId.slice(0, 18)}…, simulated chain ${CHAIN_B}) → fiat off-ramp settlement signed by the registered partner`);
  say(``);

  // ---------- 4a. Receipt reuse ----------
  say(`## 4a. Attack: reuse one receipt across two campaigns`);
  const salt2 = ethers.hexlify(ethers.randomBytes(32));
  const commitment2 = ethers.solidityPackedKeccak256(
    ["bytes32", "bytes32", "address", "uint256", "bytes32", "uint256"],
    [salt2, invoiceHash, vendor.address, amount, RELIEF, date],
  );
  await expectRevert(
    evidence.connect(ngo).submitEvidence(2, commitment2, nullifier, invoiceHash, vendor.address, amount, RELIEF, date, salt2),
    "DuplicateNullifier",
  );
  say(`- Same invoice resubmitted to campaign #2 with a fresh salt → reverted DuplicateNullifier (nullifier ignores salt)`);
  await freeze.connect(v1).triggerFreeze(2, 1);
  const f2 = await (await freeze.connect(v2).triggerFreeze(2, 1)).wait();
  say(`- Detector flagged it; verifiers 1 and 2 voted triggerFreeze(2, DUPLICATE_NULLIFIER) → CampaignFrozen event in tx ${f2!.hash}`);
  say(``);

  // ---------- 4b. Forged batch ----------
  say(`## 4b. Attack: batch of 10 receipts, 3 forged`);
  const batchIds: bigint[] = [];
  for (let i = 0; i < 10; i++) {
    const ih = ethers.keccak256(ethers.toUtf8Bytes(`BATCH-INV-${i}`));
    const s = ethers.hexlify(ethers.randomBytes(32));
    const a = U(1);
    const c = ethers.solidityPackedKeccak256(["bytes32", "bytes32", "address", "uint256", "bytes32", "uint256"], [s, ih, vendor.address, a, WATER, date]);
    const n = ethers.solidityPackedKeccak256(["bytes32", "address", "uint256", "uint256"], [ih, vendor.address, a, date + BigInt(i)]);
    await evidence.connect(ngo).submitEvidence(1, c, n, ih, vendor.address, a, WATER, date + BigInt(i), s);
    const id = BigInt(2 + i);
    batchIds.push(id);
    const forged = i >= 7;
    const signer = forged ? forger : vendor;
    const sg = ethers.Signature.from(await signer.signTypedData(domain, types, { evidenceId: id, vendor: vendor.address, amount: a, commitment: c, nonce: 0 }));
    if (forged) {
      await expectRevert(attest.connect(vendor).vendorAttest(id, a, c, sg.v, sg.r, sg.s, 0), "NotRegisteredVendor");
    } else {
      await attest.connect(vendor).vendorAttest(id, a, c, sg.v, sg.r, sg.s, 0);
      await attest.connect(v1).verifierAttest(id);
      await attest.connect(v2).verifierAttest(id);
    }
  }
  say(`- 7 receipts carry valid vendor signatures and reach quorum; 3 are signed by an unregistered key → vendorAttest reverts NotRegisteredVendor`);

  const forgedIds = batchIds.slice(7);
  await attest.connect(v3).verifierAttest(forgedIds[0]);
  say(`- Verifier 3 (colluding) attests forged receipt #${forgedIds[0]} anyway`);
  for (const id of forgedIds) {
    await attest.connect(v1).verifierChallenge(id);
    await attest.connect(admin).resolveChallenge(id, true);
  }
  const rejected = (await Promise.all(batchIds.map((id) => attest.getEvidenceState(id)))).filter((s) => Number(s) === 4).length;
  const ratio = (rejected * 100) / batchIds.length;
  const threshold = Number(await freeze.getFreezeThreshold());
  say(`- Verifier 1 challenged all 3; challenges upheld → ${rejected}/${batchIds.length} rejected = ${ratio}% (threshold ${threshold}%)`);

  const bondBefore = await registry.getVerifierBond(v3.address);
  await registry.connect(admin).slashBond(v3.address, U(5));
  const bondAfter = await registry.getVerifierBond(v3.address);
  say(`- Verifier 3 slashed: bond ${ethers.formatEther(bondBefore)} → ${ethers.formatEther(bondAfter)} mUSD; below the minimum it can no longer vote (active=${await registry.isVerifierActive(v3.address)})`);

  if (ratio > threshold) {
    await freeze.connect(v1).triggerFreeze(1, 2);
    const f1 = await (await freeze.connect(v2).triggerFreeze(1, 2)).wait();
    say(`- Forged ratio above threshold → verifiers 1 and 2 voted triggerFreeze(1, FORGED_RATIO), tx ${f1!.hash}`);
  }
  say(``);

  // ---------- 5. Frozen state ----------
  say(`## 5. Escrow frozen`);
  await expectRevert(escrow.connect(ngo).requestTrancheRelease(1, 1), "CampaignFrozen");
  say(`- Tranche 1 release on campaign #1 → reverted CampaignFrozen`);
  await musd.mint(donor.address, U(1));
  await musd.connect(donor).approve(await escrow.getAddress(), U(1));
  await expectRevert(escrow.connect(donor).deposit(1, U(1)), "CampaignFrozen");
  say(`- New deposit into campaign #1 → reverted CampaignFrozen`);
  await expectRevert(freeze.connect(ngo).voteUnfreeze(1), "NotVerifier");
  say(`- NGO tries to unfreeze → reverted NotVerifier (no single EOA can unfreeze)`);
  await escrow.connect(donor2).refundDonor(2, donor2.address);
  say(`- Donor of campaign #2 refunded ${ethers.formatEther(await musd.balanceOf(donor2.address))} mUSD via the freeze refund path`);
  const [, , , dep1, rel1, , frozen1] = await escrow.getCampaign(1);
  say(`- Campaign #1: deposited ${ethers.formatEther(dep1)}, released ${ethers.formatEther(rel1)}, frozen=${frozen1}, reason=${await freeze.getFreezeReason(1)}`);
  say(``);

  say(`## Result`);
  say(`| Check | Outcome |`);
  say(`|---|---|`);
  say(`| Honest tranche released after vendor signature + 2/3 quorum + delivery root | PASS |`);
  say(`| Cross-campaign receipt reuse blocked by global nullifier | PASS |`);
  say(`| Forged receipts rejected (${ratio}% > ${threshold}%) and campaign frozen | PASS |`);
  say(`| Colluding verifier slashed | PASS |`);
  say(`| Frozen escrow blocks releases and deposits; refund path open | PASS |`);
  say(``);
  say(`Known limitations (see SECURITY.md and reports/test-report.md): the nullifier is now derived on-chain, so resubmitting the same invoice fields under any nullifier is blocked, but an altered invoice document still hashes to a fresh nullifier (oracle problem). Freezes need two verifier votes; the forged-ratio rule itself runs off-chain. Challenge resolution and slashing are still owner-gated; chain B is simulated on one network.`);

  const out = path.join(__dirname, "..", "reports", "redteam-report.md");
  fs.mkdirSync(path.dirname(out), { recursive: true });
  fs.writeFileSync(out, log.join("\n") + "\n");
  console.log(`\nReport written to ${out}`);
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
