/**
 * Security probes. Tests named "DEFENCE:" assert a protection holds.
 * Tests named "RESIDUAL:" document a known limit of a fix. (Earlier "EXPLOIT:" tests, which
 * passed because an attack succeeded, have all been converted to DEFENCE tests.)
 * Each maps to a finding in reports/test-report.md.
 */
import { ethers } from "hardhat";
import { expect } from "chai";
import { loadFixture } from "@nomicfoundation/hardhat-network-helpers";
import { deploySystem, U, STATE } from "../integration/fixture";

type System = Awaited<ReturnType<typeof deploySystem>>;

/** A second escrow wired to the shared freeze/impact/attestation contracts, holding a malicious token. */
async function reentrantEscrow(s: System) {
  const tok: any = await (await ethers.getContractFactory("ReentrantToken")).deploy();
  const esc: any = await (await ethers.getContractFactory("CampaignEscrow")).deploy(await tok.getAddress(), await s.freeze.getAddress(), await s.impact.getAddress());
  await esc.setAttestationVerifier(await s.attest.getAddress());
  return { tok, esc };
}

describe("Security probes", function () {
  describe("DEFENCE", function () {
    it("DEFENCE: refundDonor cannot be re-entered by a malicious token", async function () {
      const s = await loadFixture(deploySystem);
      const { tok, esc } = await reentrantEscrow(s);
      const expiry = (await ethers.provider.getBlock("latest"))!.timestamp + 86400;
      await esc.connect(s.ngo).createCampaign(ethers.id("c"), U(100), expiry, [U(10)], [1]);
      await esc.connect(s.ngo).createCampaign(ethers.id("c2"), U(100), expiry, [U(10)], [1]);
      await tok.mint(s.donor.address, U(100));
      await tok.connect(s.donor).approve(await esc.getAddress(), U(100));
      await esc.connect(s.donor).deposit(1, U(40));
      await esc.connect(s.donor).deposit(2, U(40));
      // Campaign ids are shared with the fixture's FreezeController; freeze campaign 1 there.
      await s.freezeNow(1, 1);
      await tok.arm(await esc.getAddress(), await esc.getAddress(), esc.interface.encodeFunctionData("refundDonor", [1, s.donor.address]));
      await esc.refundDonor(1, s.donor.address);
      expect(await tok.reentered()).to.equal(true);
      expect(await tok.reentrySucceeded()).to.equal(false);
      expect(await tok.balanceOf(s.donor.address)).to.equal(U(60));
    });

    it("DEFENCE: tranche release cannot be re-entered by a malicious token", async function () {
      const s = await loadFixture(deploySystem);
      const { tok, esc } = await reentrantEscrow(s);
      const expiry = (await ethers.provider.getBlock("latest"))!.timestamp + 86400;
      await esc.connect(s.ngo).createCampaign(ethers.id("c"), U(100), expiry, [U(10), U(10)], [1, 1]);
      await tok.mint(s.donor.address, U(100));
      await tok.connect(s.donor).approve(await esc.getAddress(), U(100));
      await esc.connect(s.donor).deposit(1, U(40));
      await s.impact.connect(s.ngo).publishDeliveryRoot(1, ethers.id("r"));
      await s.verifyEvidence(1, U(20)); // enough for both tranches, so only the reentrancy guard stops the second
      await tok.arm(await esc.getAddress(), await esc.getAddress(), esc.interface.encodeFunctionData("requestTrancheRelease", [1, 1]));
      await esc.connect(s.ngo).requestTrancheRelease(1, 0);
      expect(await tok.reentered()).to.equal(true);
      expect(await tok.reentrySucceeded()).to.equal(false);
      expect((await esc.getCampaign(1)).nextTrancheIndex).to.equal(1n);
    });

    it("DEFENCE: only the owner can mint MockUSD or change protocol parameters", async function () {
      const s = await loadFixture(deploySystem);
      await expect(s.musd.connect(s.stranger).mint(s.stranger.address, 1)).to.be.reverted;
      await expect(s.freeze.connect(s.stranger).setRequiredUnfreezeVotes(3)).to.be.reverted;
      await expect(s.freeze.connect(s.stranger).setRequiredFreezeVotes(3)).to.be.reverted;
      await expect(s.freeze.connect(s.stranger).setFreezeThreshold(1)).to.be.reverted;
      await expect(s.attest.connect(s.stranger).setRequiredAttestations(3)).to.be.reverted;
      await expect(s.registry.connect(s.stranger).setBondToken(s.stranger.address)).to.be.reverted;
      await expect(s.registry.connect(s.stranger).closeBootstrap()).to.be.reverted;
    });

    it("DEFENCE: an admitted but unbonded verifier cannot attest, challenge or vote", async function () {
      const s = await loadFixture(deploySystem);
      await s.registry.connect(s.stranger).registerVerifier();
      await s.registry.connect(s.v1).voteAdmitVerifier(s.stranger.address);
      await s.registry.connect(s.v2).voteAdmitVerifier(s.stranger.address); // admitted by quorum
      expect(await s.registry.hasRole(await s.registry.VERIFIER_ROLE(), s.stranger.address)).to.equal(true);
      const id = await s.submit(1, s.makeEvidence("X", U(1)));
      await expect(s.attest.connect(s.stranger).verifierAttest(id)).to.be.revertedWith("VerifierNotActive");
      await expect(s.attest.connect(s.stranger).verifierChallenge(id)).to.be.revertedWith("VerifierNotActive");
      await expect(s.freeze.connect(s.stranger).triggerFreeze(1, 1)).to.be.revertedWith("VerifierNotActive");
      await s.freezeNow(1, 1);
      await expect(s.freeze.connect(s.stranger).voteUnfreeze(1)).to.be.revertedWith("VerifierNotActive");
    });

    it("DEFENCE: a verifier that withdraws its whole bond becomes inactive", async function () {
      const s = await loadFixture(deploySystem);
      await s.registry.connect(s.v3).withdrawBond(U(10));
      expect(await s.registry.isVerifierActive(s.v3.address)).to.equal(false);
    });

    it("DEFENCE C1: a campaign cannot release more than its own deposits, even if the escrow holds more", async function () {
      const s = await loadFixture(deploySystem);
      const expiry = (await ethers.provider.getBlock("latest"))!.timestamp + 86400;
      await s.escrow.connect(s.ngo).createCampaign(ethers.id("greedy"), U(100), expiry, [U(60)], [1]); // id 3
      await s.escrow.connect(s.donor).deposit(3, U(10));
      await s.escrow.connect(s.donor2).deposit(2, U(25));
      await s.escrow.connect(s.donor).deposit(1, U(40));
      await s.impact.connect(s.ngo).publishDeliveryRoot(3, ethers.id("r"));
      await s.verifyEvidence(3, U(60)); // evidence alone must not unlock other campaigns' money
      await expect(s.escrow.connect(s.ngo).requestTrancheRelease(3, 0)).to.be.revertedWith("InsufficientCampaignBalance");
      expect((await s.escrow.campaigns(1)).balance).to.equal(U(40));
      expect((await s.escrow.campaigns(2)).balance).to.equal(U(25));
      expect((await s.escrow.campaigns(3)).balance).to.equal(U(10));
    });

    it("DEFENCE C2: refunds after a partial release are pro-rata and never touch other campaigns", async function () {
      const s = await loadFixture(deploySystem);
      const extra = (await ethers.getSigners())[10];
      await s.musd.mint(extra.address, U(20));
      await s.musd.connect(extra).approve(await s.escrow.getAddress(), U(20));
      await s.escrow.connect(s.donor).deposit(1, U(30));
      await s.escrow.connect(extra).deposit(1, U(20));
      await s.escrow.connect(s.donor2).deposit(2, U(25));
      await s.impact.connect(s.ngo).publishDeliveryRoot(1, ethers.id("r"));
      await s.verifyEvidence(1, U(20));
      await s.escrow.connect(s.ngo).requestTrancheRelease(1, 0); // 20 of 50 released, 30 left
      await s.freezeNow(1, 2);
      const before = await s.musd.balanceOf(s.donor.address);
      await expect(s.escrow.refundDonor(1, s.donor.address)).to.emit(s.escrow, "Refunded").withArgs(s.donor.address, 1, U(18)); // 30 × 30/50
      expect((await s.musd.balanceOf(s.donor.address)) - before).to.equal(U(18));
      await s.escrow.refundDonor(1, extra.address);
      expect(await s.musd.balanceOf(extra.address)).to.equal(U(12)); // 20 × 30/50
      expect((await s.escrow.campaigns(1)).balance).to.equal(0n);
      // Campaign 2 is untouched and its donor is made whole.
      await s.freezeNow(2, 1);
      await s.escrow.refundDonor(2, s.donor2.address);
      expect(await s.musd.balanceOf(s.donor2.address)).to.equal(U(25));
      expect(await s.musd.balanceOf(await s.escrow.getAddress())).to.equal(0n);
    });

    it("DEFENCE C2: pro-rata rounding never strands dust; the last donor takes the exact remainder", async function () {
      const s = await loadFixture(deploySystem);
      const donors = (await ethers.getSigners()).slice(10, 13);
      const expiry = (await ethers.provider.getBlock("latest"))!.timestamp + 86400;
      await s.escrow.connect(s.ngo).createCampaign(ethers.id("odd"), 100n, expiry, [7n], [1]); // id 3, wei units
      for (const [i, d] of donors.entries()) {
        const amt = 10n + BigInt(i); // 10, 11, 12 = 33
        await s.musd.mint(d.address, amt);
        await s.musd.connect(d).approve(await s.escrow.getAddress(), amt);
        await s.escrow.connect(d).deposit(3, amt);
      }
      await s.impact.connect(s.ngo).publishDeliveryRoot(3, ethers.id("r"));
      await s.verifyEvidence(3, 7n);
      await s.escrow.connect(s.ngo).requestTrancheRelease(3, 0); // 26 left
      await s.freezeNow(3, 2);
      let paid = 0n;
      for (const d of donors) {
        const b = await s.musd.balanceOf(d.address);
        await s.escrow.refundDonor(3, d.address);
        paid += (await s.musd.balanceOf(d.address)) - b;
      }
      expect(paid).to.equal(26n);
      expect((await s.escrow.campaigns(3)).balance).to.equal(0n);
    });

    it("DEFENCE C3: tranche amounts cannot exceed the campaign target (equal is allowed)", async function () {
      const s = await loadFixture(deploySystem);
      const expiry = (await ethers.provider.getBlock("latest"))!.timestamp + 86400;
      await expect(s.escrow.connect(s.ngo).createCampaign(ethers.id("x"), U(10), expiry, [U(1000)], [1])).to.be.revertedWith("TranchesExceedTarget");
      await expect(s.escrow.connect(s.ngo).createCampaign(ethers.id("x"), U(10), expiry, [U(6), U(5)], [1, 1])).to.be.revertedWith("TranchesExceedTarget");
      await expect(s.escrow.connect(s.ngo).createCampaign(ethers.id("x"), U(10), expiry, [U(6), U(4)], [1, 1])).to.not.be.reverted;
    });

    it("DEFENCE C4: the nullifier must be derived from the invoice, so reuse cannot dodge the check", async function () {
      const s = await loadFixture(deploySystem);
      const e = s.makeEvidence("INV-REUSE", U(20));
      await s.submit(1, e);
      await expect(s.submit(2, { ...e, nullifier: ethers.id("anything-else") })).to.be.revertedWith("InvalidNullifier");
      const again = s.makeEvidence("INV-REUSE", U(20), ethers.id("other-category"), e.date);
      expect(again.nullifier).to.equal(e.nullifier); // new salt and category, same invoice fields
      await expect(s.submit(2, again)).to.be.revertedWith("DuplicateNullifier");
    });

    for (const SEED of [20261025, 7, 424242]) it(`DEFENCE C1/C2: escrow token balance always equals the sum of campaign balances (randomised, seed ${SEED})`, async function () {
      const s = await loadFixture(deploySystem);
      const donors = (await ethers.getSigners()).slice(10, 16);
      const expiry = (await ethers.provider.getBlock("latest"))!.timestamp + 86400;
      await s.escrow.connect(s.ngo).createCampaign(ethers.id("c3"), U(100), expiry, [U(15), U(15), U(15)], [1, 1, 1]); // id 3
      for (const d of donors) {
        await s.musd.mint(d.address, U(200));
        await s.musd.connect(d).approve(await s.escrow.getAddress(), U(200));
      }
      for (const id of [1, 2, 3]) {
        await s.impact.connect(s.ngo).publishDeliveryRoot(id, ethers.id(`r${id}`));
        await s.verifyEvidence(id, U(100)); // evidence is not the constraint under test here
      }
      // mulberry32: deterministic and stays within 32-bit integer maths.
      let seed = SEED;
      const rnd = (n: number) => {
        seed = (seed + 0x6d2b79f5) | 0;
        let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
        t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
        return ((t ^ (t >>> 14)) >>> 0) % n;
      };
      const deposited = new Map<string, bigint>();
      const refunded = new Map<string, bigint>();
      const ops = { deposit: 0, release: 0, freeze: 0, refund: 0 };
      for (let step = 0; step < 80; step++) {
        const id = 1 + rnd(3);
        const d = donors[rnd(donors.length)];
        // Phases: deposits only, then deposits + releases, then everything. Freezes are permanent
        // here, so allowing them early would lock every campaign before releases are exercised.
        const r = rnd(10);
        const op = step < 12 ? 0 : step < 40 ? (r < 5 ? 0 : 5) : r;
        const k = `${id}:${d.address}`;
        try {
          if (op < 5) {
            const amt = U(1 + rnd(12));
            await s.escrow.connect(d).deposit(id, amt);
            deposited.set(k, (deposited.get(k) ?? 0n) + amt);
            ops.deposit++;
          } else if (op < 8) {
            await s.escrow.connect(s.ngo).requestTrancheRelease(id, (await s.escrow.getCampaign(id)).nextTrancheIndex);
            ops.release++;
          } else if (op < 9) {
            await s.freezeNow(id, 2);
            ops.freeze++;
          } else {
            const b = await s.musd.balanceOf(d.address);
            await s.escrow.refundDonor(id, d.address);
            refunded.set(k, (refunded.get(k) ?? 0n) + (await s.musd.balanceOf(d.address)) - b);
            ops.refund++;
          }
        } catch {
          /* expected reverts: frozen, not ready, no balance, over target, already frozen */
        }
        let sum = 0n;
        for (const c of [1, 2, 3]) sum += (await s.escrow.campaigns(c)).balance;
        expect(await s.musd.balanceOf(await s.escrow.getAddress()), `step ${step}`).to.equal(sum);
      }
      for (const [k, r] of refunded) expect(r <= (deposited.get(k) ?? 0n), `refund ${k}`).to.equal(true);
      // The sequence must actually exercise every path, or the invariant proves little.
      expect(ops.deposit > 0 && ops.release > 0 && ops.freeze > 0 && ops.refund > 0, JSON.stringify(ops)).to.equal(true);
    });

    it("DEFENCE H1: a tranche is released only against quorum-verified evidence covering everything released", async function () {
      const s = await loadFixture(deploySystem);
      await s.escrow.connect(s.donor).deposit(1, U(50));
      await s.impact.connect(s.ngo).publishDeliveryRoot(1, ethers.id("made-up"));
      await expect(s.escrow.connect(s.ngo).requestTrancheRelease(1, 0)).to.be.revertedWith("InsufficientVerifiedEvidence");
      // Submitted but not yet verified evidence does not count.
      const e = s.makeEvidence("pending", U(20));
      const id = await s.submit(1, e);
      await s.attest.connect(s.v1).verifierAttest(id);
      await expect(s.escrow.connect(s.ngo).requestTrancheRelease(1, 0)).to.be.revertedWith("InsufficientVerifiedEvidence");
      await s.verifyEvidence(1, U(10)); // 10 verified < 20 tranche
      await expect(s.escrow.connect(s.ngo).requestTrancheRelease(1, 0)).to.be.revertedWith("InsufficientVerifiedEvidence");
      await s.attest.connect(s.v2).verifierAttest(id); // now 30 verified
      expect(await s.attest.verifiedAmount(1)).to.equal(U(30));
      await expect(s.escrow.connect(s.ngo).requestTrancheRelease(1, 0)).to.emit(s.escrow, "TrancheReleased");
      // The next tranche (30) needs 50 verified in total, not just 30.
      await expect(s.escrow.connect(s.ngo).requestTrancheRelease(1, 1)).to.be.revertedWith("InsufficientVerifiedEvidence");
      // Evidence verified for one campaign does not count for another.
      await s.escrow.connect(s.donor2).deposit(2, U(25));
      await s.impact.connect(s.ngo).publishDeliveryRoot(2, ethers.id("r2"));
      await expect(s.escrow.connect(s.ngo).requestTrancheRelease(2, 0)).to.be.revertedWith("InsufficientVerifiedEvidence");
    });

    it("DEFENCE H2: only the campaign's NGO can publish or replace its delivery root", async function () {
      const s = await loadFixture(deploySystem);
      await s.impact.connect(s.ngo).publishDeliveryRoot(1, ethers.id("honest"));
      await expect(s.impact.connect(s.stranger).publishDeliveryRoot(1, ethers.id("attacker"))).to.be.revertedWith("NotCampaignNGO");
      await expect(s.impact.connect(s.admin).publishDeliveryRoot(1, ethers.id("attacker"))).to.be.revertedWith("NotCampaignNGO");
      await expect(s.impact.connect(s.ngo).publishDeliveryRoot(999, ethers.id("x"))).to.be.revertedWith("CampaignNotFound");
      expect(await s.impact.getDeliveryRoot(1)).to.equal(ethers.id("honest"));
      await expect(s.impact.setEscrow(s.stranger.address)).to.be.revertedWith("AlreadySet");
    });

    it("DEFENCE H3: freezing needs a quorum of active verifiers; strangers, NGOs and the owner cannot", async function () {
      const s = await loadFixture(deploySystem);
      for (const who of [s.stranger, s.ngo, s.admin]) {
        await expect(s.freeze.connect(who).triggerFreeze(1, 4)).to.be.revertedWith("NotVerifier");
      }
      await expect(s.freeze.connect(s.v1).triggerFreeze(1, 0)).to.be.revertedWith("InvalidReason");
      await expect(s.freeze.connect(s.v1).triggerFreeze(1, 5)).to.be.revertedWith("InvalidReason");
      await s.freeze.connect(s.v1).triggerFreeze(1, 4);
      expect(await s.escrow.isFrozen(1)).to.equal(false);
      await expect(s.freeze.connect(s.v2).triggerFreeze(1, 4)).to.emit(s.freeze, "CampaignFrozen").withArgs(1, 4);
      expect(await s.escrow.isFrozen(1)).to.equal(true);
    });

    it("DEFENCE H4: sybil verifiers cannot be self-appointed, bonded cheaply, or held by an NGO", async function () {
      const s = await loadFixture(deploySystem);
      const [a, b] = [ethers.Wallet.createRandom().connect(ethers.provider), ethers.Wallet.createRandom().connect(ethers.provider)];
      for (const w of [a, b]) {
        await s.ngo.sendTransaction({ to: w.address, value: U(1) });
        await s.musd.mint(w.address, U(20));
        await s.musd.connect(w).approve(await s.registry.getAddress(), U(20));
        await s.registry.connect(w).registerVerifier(); // applying grants nothing
        await expect(s.registry.connect(w).stakeBond(U(20))).to.be.revertedWith("NotVerifier");
      }
      await expect(s.registry.admitVerifier(a.address)).to.be.revertedWith("BootstrapClosed");
      await expect(s.registry.connect(a).voteAdmitVerifier(b.address)).to.be.revertedWith("VerifierNotActive");
      // One existing verifier is not enough to admit a newcomer.
      await s.registry.connect(s.v1).voteAdmitVerifier(a.address);
      expect(await s.registry.hasRole(await s.registry.VERIFIER_ROLE(), a.address)).to.equal(false);
      await expect(s.registry.connect(s.v1).voteAdmitVerifier(a.address)).to.be.revertedWith("AlreadyVoted");
      // Admitted with a bond below the minimum: still inactive.
      await s.registry.connect(s.v2).voteAdmitVerifier(a.address);
      await s.registry.connect(a).stakeBond(U(9));
      expect(await s.registry.isVerifierActive(a.address)).to.equal(false);
      // NGOs and vendors cannot become verifiers, and verifiers cannot become NGOs.
      await expect(s.registry.connect(s.ngo).registerNGO()).to.not.be.reverted;
      await expect(s.registry.connect(s.ngo).registerVerifier()).to.be.revertedWith("ConflictOfInterest");
      await expect(s.registry.connect(s.vendor).registerVerifier()).to.be.revertedWith("ConflictOfInterest");
      await expect(s.registry.connect(s.v1).registerNGO()).to.be.revertedWith("ConflictOfInterest");
      // So the NGO cannot lift its own freeze.
      await s.freezeNow(1, 1);
      await expect(s.freeze.connect(a).voteUnfreeze(1)).to.be.revertedWith("VerifierNotActive");
      await expect(s.freeze.connect(b).voteUnfreeze(1)).to.be.revertedWith("NotVerifier");
      expect(await s.freeze.isFrozen(1)).to.equal(true);
    });

    it("DEFENCE H5: no quorum can be set below 2 and the deployer holds no verifier role", async function () {
      const s = await loadFixture(deploySystem);
      await s.freezeNow(1, 1);
      await expect(s.freeze.setRequiredUnfreezeVotes(1)).to.be.revertedWith("QuorumTooLow");
      await expect(s.freeze.setRequiredFreezeVotes(1)).to.be.revertedWith("QuorumTooLow");
      await expect(s.attest.setRequiredAttestations(1)).to.be.revertedWith("QuorumTooLow");
      await expect((await ethers.getContractFactory("AttestationVerifier")).deploy(await s.registry.getAddress(), 1, 1)).to.be.revertedWith("QuorumTooLow");
      expect(await s.registry.hasRole(await s.registry.VERIFIER_ROLE(), s.admin.address)).to.equal(false);
      await s.musd.mint(s.admin.address, U(10));
      await s.musd.approve(await s.registry.getAddress(), U(10));
      await expect(s.registry.stakeBond(U(10))).to.be.revertedWith("NotVerifier");
      await expect(s.freeze.voteUnfreeze(1)).to.be.revertedWith("NotVerifier");
      expect(await s.freeze.isFrozen(1)).to.equal(true);
    });

    it("DEFENCE H6: core dependencies cannot be swapped after deployment", async function () {
      const s = await loadFixture(deploySystem);
      expect(s.escrow.setContracts).to.equal(undefined);
      expect((s.freeze as any).setParticipantRegistry).to.equal(undefined);
      expect((s.attest as any).setParticipantRegistry).to.equal(undefined);
      await expect(s.escrow.setAttestationVerifier(s.stranger.address)).to.be.revertedWith("AlreadySet");
      await expect(s.attest.setEvidenceRegistry(s.stranger.address)).to.be.revertedWith("AlreadySet");
      await expect(s.evidence.setEscrow(s.stranger.address)).to.be.revertedWith("AlreadySet");
      // A freeze therefore holds even for the owner.
      await s.escrow.connect(s.donor).deposit(1, U(50));
      await s.impact.connect(s.ngo).publishDeliveryRoot(1, ethers.id("r"));
      await s.verifyEvidence(1, U(20));
      await s.freezeNow(1, 2);
      await expect(s.escrow.connect(s.ngo).requestTrancheRelease(1, 0)).to.be.revertedWith("CampaignFrozen");
    });

    it("DEFENCE H6: one-time wiring can only be done by the deployer", async function () {
      const [deployer, other] = await ethers.getSigners();
      const impact: any = await (await ethers.getContractFactory("ImpactVerifier")).connect(deployer).deploy();
      const evidence: any = await (await ethers.getContractFactory("EvidenceRegistry")).connect(deployer).deploy();
      await expect(impact.connect(other).setEscrow(other.address)).to.be.revertedWith("NotDeployer");
      await expect(evidence.connect(other).setEscrow(other.address)).to.be.revertedWith("NotDeployer");
      await expect(impact.setEscrow(ethers.ZeroAddress)).to.be.revertedWith("InvalidEscrow");
      await expect(impact.connect(other).publishDeliveryRoot(1, ethers.id("r"))).to.be.revertedWith("EscrowNotSet");
    });

    it("DEFENCE H7: attestations must reference submitted evidence and match its record", async function () {
      const s = await loadFixture(deploySystem);
      await expect(s.attest.connect(s.v1).verifierAttest(999)).to.be.revertedWith("EvidenceNotFound");
      await expect(s.attest.connect(s.v1).verifierChallenge(999)).to.be.revertedWith("EvidenceNotFound");
      const e = s.makeEvidence("INV-H7", U(5));
      const id = await s.submit(1, e);
      const sig = await s.vendorSign(s.vendor, id, U(50), e.commitment);
      await expect(s.attest.connect(s.vendor).vendorAttest(id, U(50), e.commitment, sig.v, sig.r, sig.s, 0)).to.be.revertedWith("EvidenceMismatch");
      await expect(s.attest.connect(s.vendor).vendorAttest(999, e.amount, e.commitment, sig.v, sig.r, sig.s, 0)).to.be.revertedWith("EvidenceNotFound");
      expect(await s.attest.getEvidenceState(999)).to.equal(STATE.SUBMITTED); // untouched default
      expect(await s.attest.verifiedAmount(1)).to.equal(0n);
    });

    it("DEFENCE H8: only the campaign's NGO can file evidence, so strangers cannot burn nullifiers", async function () {
      const s = await loadFixture(deploySystem);
      const e = s.makeEvidence("INV-front", U(5));
      await expect(s.submit(2, e, s.stranger)).to.be.revertedWith("NotCampaignNGO");
      await expect(s.submit(1, e, s.admin)).to.be.revertedWith("NotCampaignNGO");
      await s.submit(1, e); // the honest NGO is not blocked
      expect((await s.evidence.evidenceById(1)).ngo).to.equal(s.ngo.address);
    });

    it("DEFENCE H9: only the relayer can mint or relay bridge messages", async function () {
      const s = await loadFixture(deploySystem);
      await s.wusd.mint(s.ngo.address, U(5));
      await s.wusd.connect(s.ngo).approve(await s.bridge.getAddress(), U(5));
      await s.bridge.connect(s.ngo).lock(await s.wusd.getAddress(), U(5), 31338, s.offramp.address);
      await expect(s.bridge.connect(s.stranger).mint(await s.wusd.getAddress(), U(5), s.stranger.address, 31338, ethers.id("fake"))).to.be.revertedWith("NotRelayer");
      await expect(s.bridge.connect(s.stranger).relayMessage(ethers.id("fake"), 31337)).to.be.revertedWith("NotRelayer");
      expect(await s.wusd.balanceOf(s.stranger.address)).to.equal(0n);
      expect(await s.bridge.relayer()).to.equal(s.admin.address);
    });

    it("DEFENCE M7: each freeze starts a fresh vote, so earlier votes never carry over", async function () {
      const s = await loadFixture(deploySystem);
      await s.freezeNow(1, 1);
      await s.freeze.connect(s.v1).voteUnfreeze(1);
      expect(await s.freeze.getUnfreezeVotes(1)).to.equal(1n);
      await s.freeze.connect(s.v2).voteUnfreeze(1);
      expect(await s.freeze.isFrozen(1)).to.equal(false);
      expect(await s.freeze.getUnfreezeVotes(1)).to.equal(0n);
      // A new, unrelated fraud signal: the same verifiers can vote to freeze again.
      await s.freezeNow(1, 2);
      expect(await s.freeze.getFreezeReason(1)).to.equal(2);
      expect(await s.freeze.getUnfreezeVotes(1)).to.equal(0n);
      await s.freeze.connect(s.v3).voteUnfreeze(1);
      expect(await s.freeze.isFrozen(1)).to.equal(true); // one vote is not enough any more
      await s.freeze.connect(s.v1).voteUnfreeze(1); // earlier voters may vote again
      expect(await s.freeze.isFrozen(1)).to.equal(false);
    });

    it("DEFENCE M1: a verifier slashed below the minimum bond loses its vote", async function () {
      const s = await loadFixture(deploySystem);
      await s.registry.slashBond(s.v3.address, U(10));
      expect(await s.registry.getVerifierBond(s.v3.address)).to.equal(0n);
      expect(await s.registry.isVerifierActive(s.v3.address)).to.equal(false);
      await s.freezeNow(1, 1);
      await expect(s.freeze.connect(s.v3).voteUnfreeze(1)).to.be.revertedWith("VerifierNotActive");
    });

    it("DEFENCE M2: evidence cannot be filed against campaigns that do not exist", async function () {
      const s = await loadFixture(deploySystem);
      await expect(s.submit(424242, s.makeEvidence("ghost", U(1)))).to.be.revertedWith("CampaignNotFound");
    });

    it("DEFENCE: bridge messages cannot be minted twice", async function () {
      const s = await loadFixture(deploySystem);
      await s.wusd.mint(s.ngo.address, U(5));
      await s.wusd.connect(s.ngo).approve(await s.bridge.getAddress(), U(5));
      await s.bridge.connect(s.ngo).lock(await s.wusd.getAddress(), U(5), 31338, s.ngo.address);
      const id = ethers.id("m1");
      await s.bridge.mint(await s.wusd.getAddress(), U(5), s.ngo.address, 31338, id);
      await expect(s.bridge.mint(await s.wusd.getAddress(), U(5), s.ngo.address, 31338, id)).to.be.revertedWith("MessageAlreadyProcessed");
      await expect(s.bridge.mint(await s.wusd.getAddress(), 1, s.ngo.address, 31338, ethers.id("m2"))).to.be.revertedWith("NotLocked");
    });
  });

  describe("RESIDUAL", function () {
    it("RESIDUAL C4: an altered invoice document still gets a fresh nullifier", async function () {
      // Hashes bind evidence to exact document bytes. Changing one byte of the invoice gives a new
      // invoiceHash and so a new nullifier. This is the oracle problem: it is mitigated by vendor
      // signatures per receipt and off-chain duplicate detection, not by the nullifier alone.
      const s = await loadFixture(deploySystem);
      await s.submit(1, s.makeEvidence("INV-77 pumps x4", U(20)));
      await expect(s.submit(2, s.makeEvidence("INV-77 pumps x4 ", U(20)))).to.not.be.reverted;
    });

    it("RESIDUAL H8: another registered NGO holding the invoice data can still burn its nullifier first", async function () {
      // Nullifiers are global by design (cross-campaign reuse must fail), so whoever files an invoice
      // first claims it. Filing requires owning a campaign and the exact invoice fields; the vendor
      // would then refuse to sign for the wrong campaign, and the dispute is visible on-chain.
      const s = await loadFixture(deploySystem);
      const rival = s.stranger;
      const expiry = (await ethers.provider.getBlock("latest"))!.timestamp + 86400;
      await s.escrow.connect(rival).createCampaign(ethers.id("rival"), U(10), expiry, [U(10)], [1]); // id 3
      const e = s.makeEvidence("INV-victim", U(5));
      await s.submit(3, e, rival);
      await expect(s.submit(1, e)).to.be.revertedWith("DuplicateNullifier");
    });
  });

  describe("DEFENCE (medium findings)", function () {
    it("DEFENCE M3: only owner-registered partners' signatures attest a settlement, once per hop", async function () {
      const s = await loadFixture(deploySystem);
      const asset = await s.wusd.getAddress();
      const hop = ethers.id("hop-1");
      await expect(s.fiat.connect(s.stranger).registerPartner(s.stranger.address)).to.be.revertedWithCustomError(s.fiat, "OwnableUnauthorizedAccount");
      // The old exploit: an all-zero signature no longer passes.
      await expect(s.fiat.connect(s.offramp).attestFiatSettlement(hop, 1, asset, 0, ethers.ZeroHash, ethers.ZeroHash)).to.be.reverted;
      const self = await s.fiatSign(s.stranger, hop, U(1), asset);
      await expect(s.fiat.connect(s.stranger).attestFiatSettlement(hop, U(1), asset, self.v, self.r, self.s)).to.be.revertedWith("NotAuthorizedPartner");
      const sig = await s.fiatSign(s.offramp, hop, U(1), asset);
      await expect(s.fiat.attestFiatSettlement(hop, U(1), s.stranger.address, sig.v, sig.r, sig.s)).to.be.revertedWith("NotAuthorizedPartner"); // asset not signed
      await expect(s.fiat.attestFiatSettlement(ethers.id("hop-2"), U(1), asset, sig.v, sig.r, sig.s)).to.be.revertedWith("NotAuthorizedPartner"); // hop not signed
      await expect(s.fiat.attestFiatSettlement(hop, U(1), asset, sig.v, sig.r, sig.s)).to.emit(s.fiat, "FiatSettlementAttested").withArgs(hop, s.offramp.address, U(1), asset);
      await expect(s.fiat.attestFiatSettlement(hop, U(1), asset, sig.v, sig.r, sig.s)).to.be.revertedWith("AlreadyAttested");
      await expect(s.fiat.attestFiatSettlement(ethers.id("hop-3"), 0, asset, sig.v, sig.r, sig.s)).to.be.revertedWith("ZeroAmount");
      // A signature for another attestor deployment (or chain) does not transfer.
      const other: any = await (await ethers.getContractFactory("FiatOffRampAttestor")).deploy();
      await other.registerPartner(s.offramp.address);
      await expect(other.attestFiatSettlement(hop, U(1), asset, sig.v, sig.r, sig.s)).to.be.revertedWith("NotAuthorizedPartner");
    });

    it("DEFENCE M4: only the owner can change the MockSwap rate", async function () {
      const s = await loadFixture(deploySystem);
      await expect(s.swap.connect(s.stranger).setRate(1000, 1)).to.be.revertedWithCustomError(s.swap, "OwnableUnauthorizedAccount");
      expect(await s.swap.getRate()).to.deep.equal([1n, 1n]);
      await expect(s.swap.setRate(1, 0)).to.be.revertedWith("ZeroDenominator");
      await expect((await ethers.getContractFactory("MockSwap")).deploy(1, 0)).to.be.revertedWith("ZeroDenominator");
      await s.musd.mint(s.stranger.address, U(1));
      await s.musd.connect(s.stranger).approve(await s.swap.getAddress(), U(1));
      await s.swap.connect(s.stranger).swap(await s.musd.getAddress(), await s.wusd.getAddress(), U(1));
      expect(await s.wusd.balanceOf(s.stranger.address)).to.equal(U(1)); // 1:1, not 1000:1
    });

    it("DEFENCE M5: verified evidence can still be challenged, which stops it backing further releases", async function () {
      const s = await loadFixture(deploySystem);
      await s.escrow.connect(s.donor).deposit(1, U(50));
      await s.impact.connect(s.ngo).publishDeliveryRoot(1, ethers.id("r"));
      const good = await s.verifyEvidence(1, U(20));
      const late = await s.verifyEvidence(1, U(30)); // later found to be forged
      expect(await s.attest.verifiedAmount(1)).to.equal(U(50));
      await s.escrow.connect(s.ngo).requestTrancheRelease(1, 0); // 20 released
      await expect(s.attest.connect(s.v3).verifierChallenge(late)).to.emit(s.attest, "ChallengeRaised").withArgs(late, s.v3.address);
      expect(await s.attest.getEvidenceState(late)).to.equal(STATE.CHALLENGED);
      expect(await s.attest.verifiedAmount(1)).to.equal(U(20));
      await expect(s.escrow.connect(s.ngo).requestTrancheRelease(1, 1)).to.be.revertedWith("InsufficientVerifiedEvidence");
      await s.attest.resolveChallenge(late, true); // upheld: stays out
      expect(await s.attest.getEvidenceState(late)).to.equal(STATE.REJECTED);
      expect(await s.attest.verifiedAmount(1)).to.equal(U(20));
      await expect(s.escrow.connect(s.ngo).requestTrancheRelease(1, 1)).to.be.revertedWith("InsufficientVerifiedEvidence");
      // A dismissed challenge on verified evidence restores it.
      await s.attest.connect(s.v3).verifierChallenge(good);
      expect(await s.attest.verifiedAmount(1)).to.equal(0n);
      await s.attest.resolveChallenge(good, false);
      expect(await s.attest.getEvidenceState(good)).to.equal(STATE.QUORUM_VERIFIED);
      expect(await s.attest.verifiedAmount(1)).to.equal(U(20));
      // Rejected evidence cannot be challenged again or re-verified.
      await expect(s.attest.connect(s.v1).verifierChallenge(late)).to.be.revertedWith("InvalidState");
      await expect(s.attest.connect(s.v3).verifierAttest(late)).to.be.revertedWith("InvalidState");
    });

    it("DEFENCE M6: internal Merkle nodes and the root no longer verify as delivery leaves", async function () {
      const s = await loadFixture(deploySystem);
      const leaf = (x: string) => ethers.keccak256(ethers.concat(["0x00", x]));
      const node = (x: string, y: string) =>
        x.toLowerCase() <= y.toLowerCase() ? ethers.keccak256(ethers.concat(["0x01", x, y])) : ethers.keccak256(ethers.concat(["0x01", y, x]));
      const deliveries = ["a", "b", "c", "d"].map((x) => ethers.id(x));
      const [l0, l1, l2, l3] = deliveries.map(leaf);
      const n1 = node(l0, l1);
      const n2 = node(l2, l3);
      const root = node(n1, n2);
      await s.impact.connect(s.ngo).publishDeliveryRoot(1, root);
      expect(await s.impact.verifyDelivery(1, deliveries[0], [l1, n2])).to.equal(true); // real delivery still verifies
      expect(await s.impact.verifyDelivery(1, n1, [n2])).to.equal(false); // the old exploit
      expect(await s.impact.verifyDelivery(1, root, [])).to.equal(false);
      expect(await s.impact.verifyDelivery(1, l0, [l1, n2])).to.equal(false); // a leaf hash is not a delivery either
    });
  });
});
