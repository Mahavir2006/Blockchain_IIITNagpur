import { ethers } from "hardhat";
import { expect } from "chai";
import { loadFixture } from "@nomicfoundation/hardhat-network-helpers";
import { deploySystem, U, STATE } from "../integration/fixture";

describe("AttestationVerifier", function () {
    it("should track attestation count", async function () {
        const s = await loadFixture(deploySystem);
        expect(await s.attest.getAttestationCount(1)).to.equal(0);
        expect(await s.attest.getChallengeCount(1)).to.equal(0);
    });

    it("should allow verifier to attest submitted evidence", async function () {
        const s = await loadFixture(deploySystem);
        const id = await s.submit(1, s.makeEvidence("INV-A", U(5)));
        await s.attest.connect(s.v1).verifierAttest(id);
        expect(await s.attest.getAttestationCount(id)).to.equal(1);
        expect(await s.attest.getEvidenceState(id)).to.equal(STATE.SUBMITTED);
    });

    it("should credit verified evidence to its campaign at quorum", async function () {
        const s = await loadFixture(deploySystem);
        const id = await s.submit(2, s.makeEvidence("INV-B", U(7)));
        await s.attest.connect(s.v1).verifierAttest(id);
        expect(await s.attest.verifiedAmount(2)).to.equal(0n);
        await expect(s.attest.connect(s.v2).verifierAttest(id)).to.emit(s.attest, "QuorumVerified").withArgs(id);
        expect(await s.attest.verifiedAmount(2)).to.equal(U(7));
        expect(await s.attest.verifiedAmount(1)).to.equal(0n);
    });

    it("should count challenges", async function () {
        const s = await loadFixture(deploySystem);
        const id = await s.submit(1, s.makeEvidence("INV-C", U(1)));
        await s.attest.connect(s.v1).verifierChallenge(id);
        expect(await s.attest.getChallengeCount(id)).to.equal(1);
        await expect(s.attest.connect(s.v1).verifierChallenge(id)).to.be.revertedWith("InvalidState");
    });

    it("should require the evidence registry before attesting", async function () {
        const s = await loadFixture(deploySystem);
        const bare: any = await (await ethers.getContractFactory("AttestationVerifier")).deploy(await s.registry.getAddress(), 2, 1);
        await expect(bare.connect(s.v1).verifierAttest(1)).to.be.revertedWith("EvidenceRegistryNotSet");
        await expect(bare.setEvidenceRegistry(ethers.ZeroAddress)).to.be.revertedWith("InvalidRegistry");
        await expect((await ethers.getContractFactory("AttestationVerifier")).deploy(ethers.ZeroAddress, 2, 1)).to.be.revertedWith("InvalidRegistry");
    });

    it("should let the owner tune quorum sizes within bounds", async function () {
        const s = await loadFixture(deploySystem);
        await s.attest.setRequiredAttestations(3);
        await s.attest.setRequiredChallenges(2);
        expect(await s.attest.requiredAttestations()).to.equal(3);
        expect(await s.attest.requiredChallenges()).to.equal(2);
    });
});
