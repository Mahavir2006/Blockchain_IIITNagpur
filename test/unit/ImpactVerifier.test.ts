import { ethers } from "hardhat";
import { expect } from "chai";
import { loadFixture } from "@nomicfoundation/hardhat-network-helpers";
import { deploySystem } from "../integration/fixture";

describe("ImpactVerifier", function () {
    it("should publish and verify delivery root", async function () {
        const s = await loadFixture(deploySystem);
        const root = ethers.keccak256(ethers.toUtf8Bytes("merkle-root"));

        await expect(s.impact.connect(s.ngo).publishDeliveryRoot(1, root)).to.emit(s.impact, "DeliveryRootPublished").withArgs(1, root);
        expect(await s.impact.getDeliveryRoot(1)).to.equal(root);
        expect(await s.impact.getRootBlock(1)).to.be.greaterThan(0);
    });

    it("should only let the campaign NGO publish", async function () {
        const s = await loadFixture(deploySystem);
        await expect(s.impact.connect(s.stranger).publishDeliveryRoot(1, ethers.id("x"))).to.be.revertedWith("NotCampaignNGO");
        await expect(s.impact.connect(s.ngo).publishDeliveryRoot(1, ethers.ZeroHash)).to.be.revertedWith("InvalidRoot");
    });

    it("should verify valid Merkle proof", async function () {
        const s = await loadFixture(deploySystem);
        // 2-leaf tree: leaves are hashed with a 0x00 prefix, the sorted pair with 0x01.
        const a = ethers.keccak256(ethers.toUtf8Bytes("a"));
        const b = ethers.keccak256(ethers.toUtf8Bytes("b"));
        const leafHash = (x: string) => ethers.keccak256(ethers.solidityPacked(["bytes1", "bytes32"], ["0x00", x]));
        const [ha, hb] = [leafHash(a), leafHash(b)];
        const [left, right] = ha <= hb ? [ha, hb] : [hb, ha];
        const root = ethers.keccak256(ethers.solidityPacked(["bytes1", "bytes32", "bytes32"], ["0x01", left, right]));

        await s.impact.connect(s.ngo).publishDeliveryRoot(1, root);

        expect(await s.impact.verifyDelivery(1, a, [hb])).to.be.true;
        expect(await s.impact.verifyDelivery(1, b, [ha])).to.be.true;
        expect(await s.impact.verifyDelivery(1, ha, [hb])).to.be.false; // a leaf hash is not a leaf
    });

    it("should reject invalid Merkle proof", async function () {
        const s = await loadFixture(deploySystem);
        const leaf = ethers.keccak256(ethers.toUtf8Bytes("beneficiary-secret-1"));
        const root = ethers.keccak256(ethers.toUtf8Bytes("fake-root"));

        await s.impact.connect(s.ngo).publishDeliveryRoot(1, root);

        const proof = [ethers.keccak256(ethers.toUtf8Bytes("sibling"))];
        expect(await s.impact.verifyDelivery(1, leaf, proof)).to.be.false;
    });

    it("should reject verify for non-existent root", async function () {
        const s = await loadFixture(deploySystem);
        const leaf = ethers.keccak256(ethers.toUtf8Bytes("beneficiary-secret-1"));
        await expect(s.impact.verifyDelivery(999, leaf, [])).to.be.revertedWith("RootNotFound");
    });
});
