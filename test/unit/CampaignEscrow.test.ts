import { ethers } from "hardhat";
import { expect } from "chai";
import { Contract } from "ethers";
import { deploySystem } from "../integration/fixture";

describe("CampaignEscrow", function () {
    let escrow: Contract;
    let mockUSD: Contract;
    let freezeController: Contract;
    let impactVerifier: Contract;
    let participantRegistry: Contract;
    let owner: any;
    let donor: any;
    let ngo: any;

    let freezeNow: (campaignId: number, reason: number) => Promise<void>;

    beforeEach(async function () {
        // Wired system; it already holds campaigns 1 and 2, so new campaigns here start at id 3.
        const s = await deploySystem();
        [owner, donor, ngo] = [s.admin, s.donor, s.ngo];
        mockUSD = s.musd;
        escrow = s.escrow;
        freezeController = s.freeze;
        impactVerifier = s.impact;
        participantRegistry = s.registry;
        freezeNow = s.freezeNow;
        await mockUSD.connect(owner).mint(donor.address, ethers.parseEther("1000"));
    });

    it("should create a campaign", async function () {
        const tx = await escrow.connect(ngo).createCampaign(
            ethers.keccak256(ethers.toUtf8Bytes("water")),
            ethers.parseEther("1000"),
            2000000000,
            [ethers.parseEther("300"), ethers.parseEther("300"), ethers.parseEther("400")],
            [1, 1, 1]
        );

        const receipt = await tx.wait();
        const event = receipt?.logs.find((log: any) => log.fragment?.name === "CampaignCreated");
        const campaignId = event?.args?.campaignId;

        expect(campaignId).to.equal(3);

        const campaign = await escrow.getCampaign(campaignId);
        expect(campaign.ngo).to.equal(ngo.address);
        expect(campaign.target).to.equal(ethers.parseEther("1000"));
        expect(campaign.frozen).to.be.false;
    });

    it("should allow donor to deposit", async function () {
        const tx = await escrow.connect(ngo).createCampaign(
            ethers.keccak256(ethers.toUtf8Bytes("water")),
            ethers.parseEther("1000"),
            2000000000,
            [ethers.parseEther("500")],
            [1]
        );

        const receipt = await tx.wait();
        const event = receipt?.logs.find((log: any) => log.fragment?.name === "CampaignCreated");
        const campaignId = event?.args?.campaignId;

        await mockUSD.connect(donor).approve(await escrow.getAddress(), ethers.parseEther("100"));
        await escrow.connect(donor).deposit(campaignId, ethers.parseEther("100"));

        const campaign = await escrow.getCampaign(campaignId);
        expect(campaign.totalDeposited).to.equal(ethers.parseEther("100"));
    });

    it("should reject deposit to frozen campaign", async function () {
        const tx = await escrow.connect(ngo).createCampaign(
            ethers.keccak256(ethers.toUtf8Bytes("water")),
            ethers.parseEther("1000"),
            2000000000,
            [ethers.parseEther("500")],
            [1]
        );

        const receipt = await tx.wait();
        const event = receipt?.logs.find((log: any) => log.fragment?.name === "CampaignCreated");
        const campaignId = event?.args?.campaignId;

        await freezeNow(Number(campaignId), 1);
        await mockUSD.connect(donor).approve(await escrow.getAddress(), ethers.parseEther("100"));
        await expect(escrow.connect(donor).deposit(campaignId, ethers.parseEther("100"))).to.be.revertedWith(
            "CampaignFrozen"
        );
    });

    it("should refund donor when campaign is frozen", async function () {
        const tx = await escrow.connect(ngo).createCampaign(
            ethers.keccak256(ethers.toUtf8Bytes("water")),
            ethers.parseEther("1000"),
            2000000000,
            [ethers.parseEther("500")],
            [1]
        );

        const receipt = await tx.wait();
        const event = receipt?.logs.find((log: any) => log.fragment?.name === "CampaignCreated");
        const campaignId = event?.args?.campaignId;

        await mockUSD.connect(donor).approve(await escrow.getAddress(), ethers.parseEther("100"));
        await escrow.connect(donor).deposit(campaignId, ethers.parseEther("100"));

        await freezeNow(Number(campaignId), 1);
        await escrow.refundDonor(campaignId, donor.address);

        const campaign = await escrow.getCampaign(campaignId);
        expect(campaign.totalDeposited).to.equal(0);
    });

    it("should reject tranche release when frozen", async function () {
        const tx = await escrow.connect(ngo).createCampaign(
            ethers.keccak256(ethers.toUtf8Bytes("water")),
            ethers.parseEther("1000"),
            2000000000,
            [ethers.parseEther("500")],
            [1]
        );

        const receipt = await tx.wait();
        const event = receipt?.logs.find((log: any) => log.fragment?.name === "CampaignCreated");
        const campaignId = event?.args?.campaignId;

        await freezeNow(Number(campaignId), 1);
        await expect(escrow.connect(ngo).requestTrancheRelease(campaignId, 0)).to.be.revertedWith(
            "CampaignFrozen"
        );
    });
});