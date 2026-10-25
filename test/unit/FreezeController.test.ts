import { ethers } from "hardhat";
import { expect } from "chai";
import { loadFixture } from "@nomicfoundation/hardhat-network-helpers";
import { deploySystem } from "../integration/fixture";

describe("FreezeController", function () {
    async function withQuorumOf3() {
        const s = await deploySystem();
        await s.freeze.setRequiredUnfreezeVotes(3);
        return s;
    }

    it("should freeze a campaign once the verifier quorum votes", async function () {
        const s = await loadFixture(withQuorumOf3);
        await s.freeze.connect(s.v1).triggerFreeze(1, 1);
        expect(await s.freeze.isFrozen(1)).to.be.false;
        await s.freeze.connect(s.v2).triggerFreeze(1, 1);
        expect(await s.freeze.isFrozen(1)).to.be.true;
        expect(await s.freeze.getFreezeReason(1)).to.equal(1);
    });

    it("should not freeze already frozen campaign", async function () {
        const s = await loadFixture(withQuorumOf3);
        await s.freezeNow(1, 1);
        await expect(s.freeze.connect(s.v3).triggerFreeze(1, 1)).to.be.revertedWith("AlreadyFrozen");
    });

    it("should reject unknown freeze reasons", async function () {
        const s = await loadFixture(withQuorumOf3);
        await expect(s.freeze.connect(s.v1).triggerFreeze(1, 0)).to.be.revertedWith("InvalidReason");
        await expect(s.freeze.connect(s.v1).triggerFreeze(1, 9)).to.be.revertedWith("InvalidReason");
    });

    it("should allow verifiers to vote unfreeze", async function () {
        const s = await loadFixture(withQuorumOf3);
        await s.freezeNow(1, 1);
        await s.freeze.connect(s.v1).voteUnfreeze(1);
        await s.freeze.connect(s.v2).voteUnfreeze(1);
        expect(await s.freeze.getUnfreezeVotes(1)).to.equal(2);
        await s.freeze.connect(s.v3).voteUnfreeze(1);
        expect(await s.freeze.isFrozen(1)).to.be.false;
        expect(await s.freeze.getFreezeReason(1)).to.equal(0);
    });

    it("should not allow double vote", async function () {
        const s = await loadFixture(withQuorumOf3);
        await s.freezeNow(1, 1);
        await s.freeze.connect(s.v1).voteUnfreeze(1);
        await expect(s.freeze.connect(s.v1).voteUnfreeze(1)).to.be.revertedWith("AlreadyVoted");
    });

    it("should not allow non-verifier to vote", async function () {
        const s = await loadFixture(withQuorumOf3);
        await s.freezeNow(1, 1);
        await expect(s.freeze.connect(s.stranger).voteUnfreeze(1)).to.be.revertedWith("NotVerifier");
        await expect(s.freeze.connect(s.stranger).triggerFreeze(2, 1)).to.be.revertedWith("NotVerifier");
    });

    it("should not allow voting on unfrozen campaign", async function () {
        const s = await loadFixture(withQuorumOf3);
        await expect(s.freeze.connect(s.v1).voteUnfreeze(1)).to.be.revertedWith("NotFrozen");
    });

    it("should require minimum votes for unfreeze", async function () {
        const s = await loadFixture(withQuorumOf3);
        await s.freeze.setRequiredUnfreezeVotes(5);
        await s.freezeNow(1, 1);
        await s.freeze.connect(s.v1).voteUnfreeze(1);
        await s.freeze.connect(s.v2).voteUnfreeze(1);
        await s.freeze.connect(s.v3).voteUnfreeze(1);
        expect(await s.freeze.isFrozen(1)).to.be.true;
    });

    it("should reject quorums below two", async function () {
        const s = await loadFixture(withQuorumOf3);
        await expect(s.freeze.setRequiredUnfreezeVotes(1)).to.be.revertedWith("QuorumTooLow");
        await expect(s.freeze.setRequiredFreezeVotes(0)).to.be.revertedWith("QuorumTooLow");
        await expect((await ethers.getContractFactory("FreezeController")).deploy(ethers.ZeroAddress)).to.be.revertedWith("InvalidRegistry");
    });

    it("should report the configured thresholds", async function () {
        const s = await loadFixture(withQuorumOf3);
        expect(await s.freeze.getRequiredUnfreezeVotes()).to.equal(3);
        await s.freeze.setFreezeThreshold(30);
        expect(await s.freeze.getFreezeThreshold()).to.equal(30);
        expect(await s.freeze.hasRole(await s.freeze.VERIFIER_ROLE(), s.v1.address)).to.be.true;
    });
});
