import { ethers } from "hardhat";
import { expect } from "chai";
import { Contract } from "ethers";

const role = (name: string) => ethers.keccak256(ethers.toUtf8Bytes(name));

describe("ParticipantRegistry", function () {
    let registry: Contract;
    let mockUSD: Contract;
    let owner: any;
    let ngo: any;
    let vendor: any;
    let verifier: any;
    let random: any;

    beforeEach(async function () {
        [owner, ngo, vendor, verifier, random] = await ethers.getSigners();

        const MockUSD = await ethers.getContractFactory("MockUSD");
        mockUSD = await MockUSD.deploy();

        const ParticipantRegistry = await ethers.getContractFactory("ParticipantRegistry");
        registry = await ParticipantRegistry.deploy();
        await registry.setBondToken(await mockUSD.getAddress());
    });

    async function admittedAndStaked(amount = "50") {
        await registry.connect(verifier).registerVerifier();
        await registry.admitVerifier(verifier.address);
        await mockUSD.connect(owner).mint(verifier.address, ethers.parseEther("100"));
        await mockUSD.connect(verifier).approve(await registry.getAddress(), ethers.parseEther(amount));
        await registry.connect(verifier).stakeBond(ethers.parseEther(amount));
    }

    it("should deploy with owner having only DEFAULT_ADMIN_ROLE", async function () {
        expect(await registry.hasRole(ethers.ZeroHash, owner.address)).to.be.true;
        for (const r of ["NGO_ROLE", "VENDOR_ROLE", "VERIFIER_ROLE", "DONOR_ROLE"]) {
            expect(await registry.hasRole(role(r), owner.address)).to.be.false;
        }
    });

    it("should register an NGO", async function () {
        await registry.connect(ngo).registerNGO();
        expect(await registry.hasRole(role("NGO_ROLE"), ngo.address)).to.be.true;
    });

    it("should not register same role twice", async function () {
        await registry.connect(ngo).registerNGO();
        await expect(registry.connect(ngo).registerNGO()).to.be.revertedWith("AlreadyRegistered");
        await registry.connect(vendor).registerVendor(vendor.address);
        await expect(registry.connect(vendor).registerVendor(vendor.address)).to.be.revertedWith("AlreadyRegistered");
        await registry.connect(verifier).registerVerifier();
        await expect(registry.connect(verifier).registerVerifier()).to.be.revertedWith("AlreadyRegistered");
    });

    it("should register a vendor with signing address", async function () {
        await registry.connect(vendor).registerVendor(vendor.address);
        expect(await registry.hasRole(role("VENDOR_ROLE"), vendor.address)).to.be.true;
        expect(await registry.getVendorSigningAddress(vendor.address)).to.equal(vendor.address);
        await expect(registry.connect(random).registerVendor(ethers.ZeroAddress)).to.be.revertedWith("InvalidSigningAddress");
    });

    it("should treat registerVerifier as an application until admitted", async function () {
        await registry.connect(verifier).registerVerifier();
        expect(await registry.verifierApplied(verifier.address)).to.be.true;
        expect(await registry.hasRole(role("VERIFIER_ROLE"), verifier.address)).to.be.false;
        await registry.admitVerifier(verifier.address);
        expect(await registry.hasRole(role("VERIFIER_ROLE"), verifier.address)).to.be.true;
        await expect(registry.admitVerifier(verifier.address)).to.be.revertedWith("AlreadyRegistered");
        await expect(registry.admitVerifier(random.address)).to.be.revertedWith("NotApplicant");
    });

    it("should stop admin admission once the bootstrap is closed", async function () {
        await registry.closeBootstrap();
        await expect(registry.closeBootstrap()).to.be.revertedWith("BootstrapClosed");
        await registry.connect(verifier).registerVerifier();
        await expect(registry.admitVerifier(verifier.address)).to.be.revertedWith("BootstrapClosed");
        await expect(registry.connect(random).voteAdmitVerifier(verifier.address)).to.be.revertedWith("VerifierNotActive");
    });

    it("should allow verifier to stake bond and activate at the minimum", async function () {
        await admittedAndStaked("50");
        expect(await registry.getVerifierBond(verifier.address)).to.equal(ethers.parseEther("50"));
        expect(await registry.isVerifierActive(verifier.address)).to.be.true;
    });

    it("should keep a verifier inactive below the minimum bond", async function () {
        await admittedAndStaked("9");
        expect(await registry.isVerifierActive(verifier.address)).to.be.false;
    });

    it("should revert staking with zero amount or without admission", async function () {
        await expect(registry.connect(random).stakeBond(1)).to.be.revertedWith("NotVerifier");
        await registry.connect(verifier).registerVerifier();
        await registry.admitVerifier(verifier.address);
        await expect(registry.connect(verifier).stakeBond(0)).to.be.revertedWith("InsufficientBond");
    });

    it("should allow owner to slash bond", async function () {
        await admittedAndStaked("50");
        await registry.connect(owner).slashBond(verifier.address, ethers.parseEther("20"));
        expect(await registry.getVerifierBond(verifier.address)).to.equal(ethers.parseEther("30"));
    });

    it("should not allow non-owner to slash bond", async function () {
        await expect(registry.connect(random).slashBond(verifier.address, ethers.parseEther("20"))).to.be.reverted;
    });

    it("should allow verifier to withdraw bond", async function () {
        await admittedAndStaked("50");
        await registry.connect(verifier).withdrawBond(ethers.parseEther("30"));
        expect(await registry.getVerifierBond(verifier.address)).to.equal(ethers.parseEther("20"));
        await expect(registry.connect(verifier).withdrawBond(ethers.parseEther("21"))).to.be.revertedWith("InsufficientBond");
        await expect(registry.connect(random).withdrawBond(1)).to.be.revertedWith("NotVerifier");
    });

    it("should track verifier nonces", async function () {
        await admittedAndStaked("50");
        await registry.connect(verifier).incrementVerifierNonce(verifier.address);
        expect(await registry.getVerifierNonce(verifier.address)).to.equal(1);
        await expect(registry.connect(random).incrementVerifierNonce(random.address)).to.be.reverted;
    });
});
