import { ethers } from "hardhat";
import { expect } from "chai";
import { loadFixture, time } from "@nomicfoundation/hardhat-network-helpers";
import { deploySystem, U, STATE } from "./fixture";
import * as fs from "fs";
import * as path from "path";
import Module from "module";
import * as ts from "typescript";

// The dashboard package is ESM ("type": "module"), so transpile its Merkle module to CJS
// here to test the exact code the UI runs against the on-chain verifier.
function loadDashboardMerkle(): typeof import("../../dashboard/src/lib/merkle") {
  const file = path.join(__dirname, "../../dashboard/src/lib/merkle.ts");
  const out = ts.transpileModule(fs.readFileSync(file, "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 } }).outputText;
  const m = new Module(file) as any;
  m.filename = file;
  m.paths = (Module as any)._nodeModulePaths(path.dirname(__filename));
  m._compile(out, file);
  return m.exports;
}
const { buildTree, verifyProof } = loadDashboardMerkle();

describe("Integration: donation → release lifecycle", function () {
  async function honestEvidence(s: Awaited<ReturnType<typeof deploySystem>>, campaignId = 1, label = "INV-1") {
    const e = s.makeEvidence(label, U(20));
    const id = await s.submit(campaignId, e);
    const sig = await s.vendorSign(s.vendor, id, e.amount, e.commitment);
    await s.attest.connect(s.vendor).vendorAttest(id, e.amount, e.commitment, sig.v, sig.r, sig.s, 0);
    await s.attest.connect(s.v1).verifierAttest(id);
    await s.attest.connect(s.v2).verifierAttest(id);
    return { id, e };
  }

  it("runs the full happy path and moves the right balances", async function () {
    const s = await loadFixture(deploySystem);
    await expect(s.escrow.connect(s.donor).deposit(1, U(50))).to.emit(s.escrow, "DepositReceived").withArgs(s.donor.address, 1, U(50));
    const { id } = await honestEvidence(s);
    expect(await s.attest.getEvidenceState(id)).to.equal(STATE.QUORUM_VERIFIED);

    await expect(s.escrow.connect(s.ngo).requestTrancheRelease(1, 0)).to.be.revertedWith("TrancheNotReady");

    const leaves = ["a|1", "b|2", "c|3"].map((x) => ethers.keccak256(ethers.toUtf8Bytes(x)));
    const tree = buildTree(leaves);
    await s.impact.connect(s.ngo).publishDeliveryRoot(1, tree.root);

    await expect(s.escrow.connect(s.ngo).requestTrancheRelease(1, 1)).to.be.revertedWith("TrancheOutOfOrder");
    await expect(s.escrow.connect(s.stranger).requestTrancheRelease(1, 0)).to.be.revertedWith("NotNGO");
    await expect(s.escrow.connect(s.ngo).requestTrancheRelease(1, 0)).to.emit(s.escrow, "TrancheReleased").withArgs(1, 0, U(20));
    await expect(s.escrow.connect(s.ngo).requestTrancheRelease(1, 0)).to.be.revertedWith("TrancheAlreadyReleased");
    await expect(s.escrow.connect(s.ngo).requestTrancheRelease(1, 1)).to.be.revertedWith("InsufficientVerifiedEvidence");
    await s.verifyEvidence(1, U(30));
    await s.escrow.connect(s.ngo).requestTrancheRelease(1, 1);
    await expect(s.escrow.connect(s.ngo).requestTrancheRelease(1, 2)).to.be.revertedWith("InvalidTrancheIndex");

    const c = await s.escrow.getCampaign(1);
    expect(c.totalReleased).to.equal(U(50));
    expect(c.nextTrancheIndex).to.equal(2n);
    expect(await s.musd.balanceOf(s.ngo.address)).to.equal(U(50));
    expect(await s.musd.balanceOf(await s.escrow.getAddress())).to.equal(0n);
  });

  it("reverts a tranche larger than the escrow balance", async function () {
    const s = await loadFixture(deploySystem);
    await s.escrow.connect(s.donor).deposit(1, U(10));
    await s.impact.connect(s.ngo).publishDeliveryRoot(1, ethers.id("root"));
    await expect(s.escrow.connect(s.ngo).requestTrancheRelease(1, 0)).to.be.reverted;
  });

  it("moves the released tranche through swap → bridge → off-ramp", async function () {
    const s = await loadFixture(deploySystem);
    await s.escrow.connect(s.donor).deposit(1, U(50));
    await s.impact.connect(s.ngo).publishDeliveryRoot(1, ethers.id("root"));
    await s.verifyEvidence(1, U(20));
    await s.escrow.connect(s.ngo).requestTrancheRelease(1, 0);

    await s.musd.connect(s.ngo).approve(await s.swap.getAddress(), U(20));
    await expect(s.swap.connect(s.ngo).swap(await s.musd.getAddress(), await s.wusd.getAddress(), U(20))).to.emit(s.swap, "SwapExecuted");
    expect(await s.wusd.balanceOf(s.ngo.address)).to.equal(U(20));

    await s.wusd.connect(s.ngo).approve(await s.bridge.getAddress(), U(20));
    const rc = await (await s.bridge.connect(s.ngo).lock(await s.wusd.getAddress(), U(20), 31338, s.offramp.address)).wait();
    const ev = rc.logs.map((l: any) => { try { return s.bridge.interface.parseLog(l); } catch { return null; } }).find((e: any) => e?.name === "AssetLocked");
    const messageId = ev.args.messageId;
    await s.bridge.mint(await s.wusd.getAddress(), U(20), s.offramp.address, 31338, messageId);
    await expect(s.bridge.mint(await s.wusd.getAddress(), U(20), s.offramp.address, 31338, messageId)).to.be.revertedWith("MessageAlreadyProcessed");
    expect(await s.wusd.balanceOf(s.offramp.address)).to.equal(U(20));

    const asset = await s.wusd.getAddress();
    const forged = await s.fiatSign(s.stranger, messageId, U(20), asset);
    await expect(s.fiat.attestFiatSettlement(messageId, U(20), asset, forged.v, forged.r, forged.s)).to.be.revertedWith("NotAuthorizedPartner");
    const sig = await s.fiatSign(s.offramp, messageId, U(20), asset);
    await expect(s.fiat.attestFiatSettlement(messageId, U(21), asset, sig.v, sig.r, sig.s)).to.be.revertedWith("NotAuthorizedPartner"); // amount not signed
    await expect(s.fiat.connect(s.stranger).attestFiatSettlement(messageId, U(20), asset, sig.v, sig.r, sig.s))
      .to.emit(s.fiat, "FiatSettlementAttested").withArgs(messageId, s.offramp.address, U(20), asset); // anyone may relay a valid signature
    await expect(s.fiat.attestFiatSettlement(messageId, U(20), asset, sig.v, sig.r, sig.s)).to.be.revertedWith("AlreadyAttested");
  });

  it("enforces deposit limits", async function () {
    const s = await loadFixture(deploySystem);
    await expect(s.escrow.connect(s.donor).deposit(1, 0)).to.be.revertedWith("InvalidAmount");
    await expect(s.escrow.connect(s.donor).deposit(99, U(1))).to.be.revertedWith("CampaignNotFound");
    await s.musd.mint(s.donor.address, U(100));
    await s.musd.connect(s.donor).approve(await s.escrow.getAddress(), U(150));
    await s.escrow.connect(s.donor).deposit(1, U(100));
    await expect(s.escrow.connect(s.donor).deposit(1, U(1))).to.be.revertedWith("ExceedsTarget");
  });

  it("refunds after expiry and blocks release once expired", async function () {
    const s = await loadFixture(deploySystem);
    await s.escrow.connect(s.donor).deposit(1, U(50));
    await expect(s.escrow.refundDonor(1, s.donor.address)).to.be.revertedWith("NotRefundable");
    await s.impact.connect(s.ngo).publishDeliveryRoot(1, ethers.id("root"));
    await time.increaseTo(s.expiry + 1);
    await expect(s.escrow.connect(s.ngo).requestTrancheRelease(1, 0)).to.be.revertedWith("CampaignExpired");
    await expect(s.escrow.refundDonor(1, s.donor.address)).to.emit(s.escrow, "Refunded").withArgs(s.donor.address, 1, U(50));
    expect(await s.musd.balanceOf(s.donor.address)).to.equal(U(50));
    await expect(s.escrow.refundDonor(1, s.donor.address)).to.be.revertedWith("NoBalance");
  });

  it("freezes, blocks money movement, and unfreezes only with a verifier quorum", async function () {
    const s = await loadFixture(deploySystem);
    await s.escrow.connect(s.donor).deposit(1, U(50));
    await s.impact.connect(s.ngo).publishDeliveryRoot(1, ethers.id("root"));
    await s.verifyEvidence(1, U(20));
    await expect(s.freeze.connect(s.stranger).triggerFreeze(1, 2)).to.be.revertedWith("NotVerifier");
    await s.freeze.connect(s.v1).triggerFreeze(1, 2);
    expect(await s.freeze.isFrozen(1)).to.equal(false); // one vote is not a quorum
    await expect(s.freeze.connect(s.v1).triggerFreeze(1, 2)).to.be.revertedWith("AlreadyVoted");
    await expect(s.freeze.connect(s.v2).triggerFreeze(1, 2)).to.emit(s.freeze, "CampaignFrozen").withArgs(1, 2);
    await expect(s.freeze.connect(s.v3).triggerFreeze(1, 2)).to.be.revertedWith("AlreadyFrozen");
    expect((await s.escrow.getCampaign(1)).frozen).to.equal(true);
    await expect(s.escrow.connect(s.ngo).requestTrancheRelease(1, 0)).to.be.revertedWith("CampaignFrozen");
    await expect(s.escrow.connect(s.donor2).deposit(1, U(1))).to.be.revertedWith("CampaignFrozen");

    await expect(s.freeze.connect(s.ngo).voteUnfreeze(1)).to.be.revertedWith("NotVerifier");
    await s.freeze.connect(s.v1).voteUnfreeze(1);
    await expect(s.freeze.connect(s.v1).voteUnfreeze(1)).to.be.revertedWith("AlreadyVoted");
    expect(await s.freeze.isFrozen(1)).to.equal(true);
    await expect(s.freeze.connect(s.v2).voteUnfreeze(1)).to.emit(s.freeze, "CampaignUnfrozen").withArgs(1);
    expect(await s.freeze.getFreezeReason(1)).to.equal(0);
    await expect(s.escrow.connect(s.ngo).requestTrancheRelease(1, 0)).to.emit(s.escrow, "TrancheReleased");
  });

  it("refunds every donor while frozen and keeps accounting consistent", async function () {
    const s = await loadFixture(deploySystem);
    await s.escrow.connect(s.donor).deposit(2, U(50));
    await s.escrow.connect(s.donor2).deposit(2, U(25));
    await s.freezeNow(2, 1);
    await s.escrow.refundDonor(2, s.donor.address);
    await s.escrow.refundDonor(2, s.donor2.address);
    expect((await s.escrow.getCampaign(2)).totalDeposited).to.equal(0n);
    expect(await s.musd.balanceOf(await s.escrow.getAddress())).to.equal(0n);
  });

  it("blocks cross-campaign receipt reuse even with a new salt and category", async function () {
    const s = await loadFixture(deploySystem);
    const { e } = await honestEvidence(s);
    const again = { ...s.makeEvidence("INV-1", U(20)), date: e.date };
    again.nullifier = e.nullifier;
    await expect(s.submit(2, again)).to.be.revertedWith("DuplicateNullifier");
    expect(await s.evidence.isNullifierUsed(e.nullifier)).to.equal(true);
  });

  it("rejects forged and replayed vendor signatures", async function () {
    const s = await loadFixture(deploySystem);
    const e = s.makeEvidence("INV-F", U(5));
    const id = await s.submit(1, e);
    const forged = await s.vendorSign(s.stranger, id, e.amount, e.commitment);
    await expect(s.attest.connect(s.vendor).vendorAttest(id, e.amount, e.commitment, forged.v, forged.r, forged.s, 0)).to.be.revertedWith("NotRegisteredVendor");

    const good = await s.vendorSign(s.vendor, id, e.amount, e.commitment);
    const other = await s.submit(1, s.makeEvidence("INV-G", U(5)));
    await expect(s.attest.connect(s.vendor).vendorAttest(other, e.amount, e.commitment, good.v, good.r, good.s, 0)).to.be.revertedWith("EvidenceMismatch");
    await expect(s.attest.connect(s.vendor).vendorAttest(id, e.amount + 1n, e.commitment, good.v, good.r, good.s, 0)).to.be.revertedWith("EvidenceMismatch");
    await expect(s.attest.connect(s.stranger).vendorAttest(id, e.amount, e.commitment, good.v, good.r, good.s, 0)).to.be.revertedWith("NotEvidenceVendor");
    await s.attest.connect(s.vendor).vendorAttest(id, e.amount, e.commitment, good.v, good.r, good.s, 0);
    await expect(s.attest.connect(s.vendor).vendorAttest(id, e.amount, e.commitment, good.v, good.r, good.s, 0)).to.be.revertedWith("InvalidState");
  });

  it("handles verifier quorum, challenges and their resolution", async function () {
    const s = await loadFixture(deploySystem);
    const id = await s.submit(1, s.makeEvidence("INV-Q", U(5)));
    await expect(s.attest.connect(s.stranger).verifierAttest(id)).to.be.revertedWith("NotVerifier");
    await s.attest.connect(s.v1).verifierAttest(id);
    await expect(s.attest.connect(s.v1).verifierAttest(id)).to.be.revertedWith("AlreadyAttested");
    await expect(s.attest.connect(s.v3).verifierChallenge(id)).to.emit(s.attest, "ChallengeRaised");
    expect(await s.attest.getEvidenceState(id)).to.equal(STATE.CHALLENGED);
    await expect(s.attest.connect(s.v2).verifierAttest(id)).to.be.revertedWith("InvalidState");
    await expect(s.attest.connect(s.v1).resolveChallenge(id, true)).to.be.reverted;
    await s.attest.resolveChallenge(id, false);
    expect(await s.attest.getEvidenceState(id)).to.equal(STATE.VENDOR_ATTESTED);
    await s.attest.connect(s.v2).verifierAttest(id);
    expect(await s.attest.getEvidenceState(id)).to.equal(STATE.QUORUM_VERIFIED);
    // Verified evidence stays challengeable; the challenge withdraws it from the verified total.
    expect(await s.attest.verifiedAmount(1)).to.equal(U(5));
    await s.attest.connect(s.v1).verifierChallenge(id);
    expect(await s.attest.verifiedAmount(1)).to.equal(0n);
    await s.attest.resolveChallenge(id, false); // dismissed: restored
    expect(await s.attest.getEvidenceState(id)).to.equal(STATE.QUORUM_VERIFIED);
    expect(await s.attest.verifiedAmount(1)).to.equal(U(5));
    await expect(s.attest.connect(s.v1).verifierChallenge(id)).to.be.revertedWith("AlreadyChallenged");
  });

  it("supports commit–reveal of evidence salt", async function () {
    const s = await loadFixture(deploySystem);
    const e = s.makeEvidence("INV-R", U(3));
    const id = await s.submit(1, e);
    await expect(s.evidence.connect(s.stranger).revealEvidence(id, e.salt)).to.be.revertedWith("NotOwner");
    await expect(s.evidence.connect(s.ngo).revealEvidence(id, ethers.id("wrong"))).to.be.revertedWith("InvalidCommitment");
    await s.evidence.connect(s.ngo).revealEvidence(id, e.salt);
    await expect(s.evidence.connect(s.ngo).revealEvidence(id, e.salt)).to.be.revertedWith("AlreadyRevealed");
    await expect(s.evidence.revealEvidence(999, e.salt)).to.be.revertedWith("EvidenceNotFound");
  });

  it("slashes a verifier and pays the stake to the slasher, not the verifier", async function () {
    const s = await loadFixture(deploySystem);
    const before = await s.musd.balanceOf(s.admin.address);
    await expect(s.registry.slashBond(s.v3.address, U(4))).to.emit(s.registry, "BondSlashed").withArgs(s.v3.address, U(4));
    expect(await s.registry.getVerifierBond(s.v3.address)).to.equal(U(6));
    expect(await s.registry.isVerifierActive(s.v3.address)).to.equal(false); // below MIN_VERIFIER_BOND
    expect(await s.musd.balanceOf(s.v3.address)).to.equal(0n);
    expect(await s.musd.balanceOf(s.admin.address)).to.equal(before + U(4));
    await expect(s.registry.slashBond(s.v3.address, U(7))).to.be.revertedWith("InsufficientBond");
    await expect(s.registry.connect(s.v1).slashBond(s.v3.address, 1)).to.be.reverted;
  });
});

describe("Integration: Merkle delivery proofs (contract vs dashboard)", function () {
  it("agrees with the dashboard verifier for every leaf of trees sized 1–17", async function () {
    const s = await loadFixture(deploySystem);
    for (let n = 1; n <= 17; n++) {
      const leaves = Array.from({ length: n }, (_, i) => ethers.keccak256(ethers.toUtf8Bytes(`secret-${n}-${i}|kit`)));
      const tree = buildTree(leaves);
      await s.impact.connect(s.ngo).publishDeliveryRoot(1, tree.root);
      for (let i = 0; i < n; i++) {
        const proof = tree.proof(i);
        expect(verifyProof(tree.root, leaves[i], proof), `dashboard n=${n} i=${i}`).to.equal(true);
        expect(await s.impact.verifyDelivery(1, leaves[i], proof), `contract n=${n} i=${i}`).to.equal(true);
      }
      const outsider = ethers.id(`outsider-${n}`);
      const p0 = tree.proof(0);
      expect(verifyProof(tree.root, outsider, p0)).to.equal(false);
      expect(await s.impact.verifyDelivery(1, outsider, p0)).to.equal(false);
      if (p0.length) {
        const tampered = [...p0];
        tampered[0] = ethers.id("tamper");
        expect(verifyProof(tree.root, leaves[0], tampered)).to.equal(false);
        expect(await s.impact.verifyDelivery(1, leaves[0], tampered)).to.equal(false);
      }
    }
  });

  it("treats uppercase hex input the same as lowercase in the dashboard", async function () {
    const leaves = ["x", "y"].map((v) => ethers.id(v));
    const tree = buildTree(leaves);
    const up = (h: string) => "0x" + h.slice(2).toUpperCase();
    expect(verifyProof(up(tree.root), up(leaves[0]), tree.proof(0).map(up))).to.equal(true);
  });

  it("rejects a zero root and unknown campaigns", async function () {
    const s = await loadFixture(deploySystem);
    await expect(s.impact.publishDeliveryRoot(1, ethers.ZeroHash)).to.be.revertedWith("InvalidRoot");
    await expect(s.impact.verifyDelivery(555, ethers.ZeroHash, [])).to.be.revertedWith("RootNotFound");
  });
});
