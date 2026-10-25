/** @type import('hardhat/config').HardhatUserConfig */
const { HardhatUserConfig } = require("hardhat/config");
require("@nomicfoundation/hardhat-toolbox");

module.exports = {
  solidity: {
    version: "0.8.24",
    settings: {
      optimizer: {
        enabled: true,
        runs: 200,
      },
      viaIR: true,
    },
  },
  networks: {
    localhost: {
      url: "http://127.0.0.1:8545",
      chainId: 31337,
    },
    chainb: {
      url: "http://127.0.0.1:8546",
      chainId: 31338,
    },
    sepolia: {
      url: process.env.SEPOLIA_RPC_URL || "",
      accounts: process.env.SEPOLIA_PRIVATE_KEY !== undefined ? [process.env.SEPOLIA_PRIVATE_KEY] : [],
      chainId: 11155111,
    },
    amoy: {
      url: process.env.AMOY_RPC_URL || "",
      accounts: process.env.AMOY_PRIVATE_KEY !== undefined ? [process.env.AMOY_PRIVATE_KEY] : [],
      chainId: 80002,
    },
  },
  typechain: {
    outDir: "typechain",
    target: "ethers-v6",
  },
  mocha: {
    timeout: 120000,
  },
};