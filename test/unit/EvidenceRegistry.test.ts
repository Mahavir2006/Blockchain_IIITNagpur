import { ethers } from "hardhat";
import { expect } from "chai";
import { Contract } from "ethers";
import { deploySystem } from "../integration/fixture";

// nullifier = keccak256(invoiceHash || vendorId || amount || date), as enforced on-chain.
const nullifierFor = (invoiceHash: string, vendor: string, amount: bigint, date: bigint) =>
    ethers.solidityPackedKeccak256(["bytes32", "address", "uint256", "uint256"], [invoiceHash, vendor, amount, date]);

describe("EvidenceRegistry", function () {
    let registry: Contract;
    let owner: any;
    let ngo: any;

    let stranger: any;

    beforeEach(async function () {
        // Wired system: campaigns 1 and 2 belong to `ngo`, the only account allowed to file evidence for them.
        const s = await deploySystem();
        registry = s.evidence;
        [owner, ngo, stranger] = [s.admin, s.ngo, s.stranger];
    });

    it("should only accept evidence from the campaign NGO", async function () {
        const invoiceHash = ethers.keccak256(ethers.toUtf8Bytes("invoice-001"));
        const args = [
            invoiceHash,
            stranger.address,
            ethers.parseEther("100"),
            ethers.keccak256(ethers.toUtf8Bytes("water")),
            1700000000,
            ethers.keccak256(ethers.toUtf8Bytes("salt-001")),
        ] as const;
        const nullifier = nullifierFor(invoiceHash, stranger.address, ethers.parseEther("100"), 1700000000n);
        const commitment = ethers.keccak256(ethers.toUtf8Bytes("commitment-001"));
        await expect(registry.connect(stranger).submitEvidence(1, commitment, nullifier, ...args)).to.be.revertedWith("NotCampaignNGO");
        await expect(registry.connect(ngo).submitEvidence(99, commitment, nullifier, ...args)).to.be.revertedWith("CampaignNotFound");
    });

    it("should require escrow wiring before accepting evidence", async function () {
        const bare: any = await (await ethers.getContractFactory("EvidenceRegistry")).deploy();
        await expect(
            bare.submitEvidence(1, ethers.ZeroHash, ethers.ZeroHash, ethers.ZeroHash, owner.address, 1, ethers.ZeroHash, 1, ethers.ZeroHash)
        ).to.be.revertedWith("EscrowNotSet");
        await expect(bare.getEvidenceVendor(1)).to.be.revertedWith("EvidenceNotFound");
    });

    it("should submit evidence with unique nullifier", async function () {
        const invoiceHash = ethers.keccak256(ethers.toUtf8Bytes("invoice-001"));
        const nullifier = nullifierFor(invoiceHash, ngo.address, ethers.parseEther("100"), 1700000000n);
        const commitment = ethers.keccak256(ethers.toUtf8Bytes("commitment-001"));

        const tx = await registry.connect(ngo).submitEvidence(
            1,
            commitment,
            nullifier,
            invoiceHash,
            ngo.address,
            ethers.parseEther("100"),
            ethers.keccak256(ethers.toUtf8Bytes("water")),
            1700000000,
            ethers.keccak256(ethers.toUtf8Bytes("salt-001"))
        );

        const receipt = await tx.wait();
        const event = receipt?.logs.find((log: any) => log.fragment?.name === "EvidenceSubmitted");
        expect(event).to.not.be.undefined;
        expect(await registry.isNullifierUsed(nullifier)).to.be.true;
    });

    it("should reject duplicate nullifier", async function () {
        const invoiceHash = ethers.keccak256(ethers.toUtf8Bytes("invoice-001"));
        const nullifier = nullifierFor(invoiceHash, ngo.address, ethers.parseEther("100"), 1700000000n);
        const commitment = ethers.keccak256(ethers.toUtf8Bytes("commitment-001"));

        await registry.connect(ngo).submitEvidence(
            1,
            commitment,
            nullifier,
            invoiceHash,
            ngo.address,
            ethers.parseEther("100"),
            ethers.keccak256(ethers.toUtf8Bytes("water")),
            1700000000,
            ethers.keccak256(ethers.toUtf8Bytes("salt-001"))
        );

        const commitment2 = ethers.keccak256(ethers.toUtf8Bytes("commitment-002"));
        await expect(
            registry.connect(ngo).submitEvidence(
                2,
                commitment2,
                nullifier,
                invoiceHash,
                ngo.address,
                ethers.parseEther("100"),
                ethers.keccak256(ethers.toUtf8Bytes("water")),
                1700000000,
                ethers.keccak256(ethers.toUtf8Bytes("salt-002"))
            )
        ).to.be.revertedWith("DuplicateNullifier");
    });

    it("should reject a nullifier that is not derived from the invoice fields", async function () {
        const invoiceHash = ethers.keccak256(ethers.toUtf8Bytes("invoice-001"));
        const commitment = ethers.keccak256(ethers.toUtf8Bytes("commitment-001"));
        await expect(
            registry.connect(ngo).submitEvidence(
                1,
                commitment,
                ethers.keccak256(ethers.toUtf8Bytes("made-up")),
                invoiceHash,
                ngo.address,
                ethers.parseEther("100"),
                ethers.keccak256(ethers.toUtf8Bytes("water")),
                1700000000,
                ethers.keccak256(ethers.toUtf8Bytes("salt-001"))
            )
        ).to.be.revertedWith("InvalidNullifier");
    });

    it("should allow revealing evidence with correct salt", async function () {
        const salt = ethers.keccak256(ethers.toUtf8Bytes("my-salt"));
        const invoiceHash = ethers.keccak256(ethers.toUtf8Bytes("invoice-001"));
        const nullifier = nullifierFor(invoiceHash, ngo.address, ethers.parseEther("100"), 1700000000n);

        const amount = ethers.parseEther("100");
        const category = ethers.keccak256(ethers.toUtf8Bytes("water"));
        const date = 1700000000n;
        const commitment = ethers.keccak256(
            ethers.solidityPacked(
                ["bytes32", "bytes32", "address", "uint256", "bytes32", "uint256"],
                [salt, invoiceHash, ngo.address, amount, category, date]
            )
        );

        const tx = await registry.connect(ngo).submitEvidence(
            1,
            commitment,
            nullifier,
            invoiceHash,
            ngo.address,
            amount,
            category,
            date,
            salt
        );

        const receipt = await tx.wait();
        const event = receipt?.logs.find((log: any) => log.fragment?.name === "EvidenceSubmitted");
        const evidenceId = event?.args?.evidenceId || 1;

        await registry.connect(ngo).revealEvidence(evidenceId, salt);

        const evidence = await registry.getEvidence(evidenceId);
        expect(evidence.revealed).to.be.true;
    });

    it("should reject revealing with wrong salt", async function () {
        const salt = ethers.keccak256(ethers.toUtf8Bytes("my-salt"));
        const wrongSalt = ethers.keccak256(ethers.toUtf8Bytes("wrong-salt"));
        const invoiceHash = ethers.keccak256(ethers.toUtf8Bytes("invoice-001"));
        const nullifier = nullifierFor(invoiceHash, ngo.address, ethers.parseEther("100"), 1700000000n);
        const commitment = ethers.keccak256(ethers.toUtf8Bytes("commitment-001"));

        const tx = await registry.connect(ngo).submitEvidence(
            1,
            commitment,
            nullifier,
            invoiceHash,
            ngo.address,
            ethers.parseEther("100"),
            ethers.keccak256(ethers.toUtf8Bytes("water")),
            1700000000,
            salt
        );

        const receipt = await tx.wait();
        const event = receipt?.logs.find((log: any) => log.fragment?.name === "EvidenceSubmitted");
        const evidenceId = event?.args?.evidenceId || 1;

        await expect(registry.connect(ngo).revealEvidence(evidenceId, wrongSalt)).to.be.revertedWith(
            "InvalidCommitment"
        );
    });

    it("should return evidence details", async function () {
        const invoiceHash = ethers.keccak256(ethers.toUtf8Bytes("invoice-001"));
        const nullifier = nullifierFor(invoiceHash, ngo.address, ethers.parseEther("100"), 1700000000n);
        const commitment = ethers.keccak256(ethers.toUtf8Bytes("commitment-001"));

        await registry.connect(ngo).submitEvidence(
            1,
            commitment,
            nullifier,
            invoiceHash,
            ngo.address,
            ethers.parseEther("100"),
            ethers.keccak256(ethers.toUtf8Bytes("water")),
            1700000000,
            ethers.keccak256(ethers.toUtf8Bytes("salt-001"))
        );

        const evidence = await registry.getEvidence(1);
        expect(evidence.campaignId).to.equal(1);
        expect(evidence.commitment).to.equal(commitment);
        expect(evidence.nullifier).to.equal(nullifier);
        expect(evidence.ngo).to.equal(ngo.address);
        expect(evidence.amount).to.equal(ethers.parseEther("100"));
    });
});