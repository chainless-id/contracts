import { ethers } from "hardhat";
import { deploy, IDeployConfig } from "./helpers";

(async () => {
  const config: IDeployConfig = {
    trustedForwarder: "0x6271Ca63D30507f2Dcbf99B52787032506D75BBF",
    bicoOwner: "0x501b9BF108456d7d67d4C3D1928802dE58292C22",
    pauser: "0x501b9BF108456d7d67d4C3D1928802dE58292C22",
    tokens: [
      {
        tokenAddress: "0xB4E0F6FEF81BdFea0856bB846789985c9CFf7e85",
        minCap: ethers.BigNumber.from(10).pow(18 + 2),
        maxCap: ethers.BigNumber.from(10).pow(18 + 4),
        depositConfigs: [
          {
            chainId: 5,
            minCap: ethers.BigNumber.from(10).pow(18 + 2),
            // Max Cap needs to be less than the maxTransfer Fee on destination chain id to cover for incentive amount
            maxCap: ethers.BigNumber.from(9).mul(ethers.BigNumber.from(10).pow(18 + 3)),
          },
          {
            chainId: 80001,
            minCap: ethers.BigNumber.from(10).pow(18 + 2),
            // Max Cap needs to be less than the maxTransfer Fee on destination chain id to cover for incentive amount
            maxCap: ethers.BigNumber.from(9).mul(ethers.BigNumber.from(10).pow(18 + 3)),
          },
        ],
        equilibriumFee: 10000000,
        maxFee: 200000000,
        transferOverhead: 0,
        maxWalletLiquidityCap: ethers.BigNumber.from(10).pow(18 + 4),
        maxLiquidityCap: ethers.BigNumber.from(10).pow(18 + 5),
        svgHelper: await ethers.getContractFactory("AvalancheUSDT"),
        decimals: 18,
        rewardRatePerSecond: 100,
        rewardTokenAddress: "0xB4E0F6FEF81BdFea0856bB846789985c9CFf7e85",
      },
      {
        tokenAddress: "0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE",
        minCap: ethers.BigNumber.from(10).pow(18 - 2),
        maxCap: ethers.BigNumber.from(10).pow(18 + 2),
        depositConfigs: [
          {
            chainId: 80001,
            minCap: ethers.BigNumber.from(10).pow(18 - 2),
            // Max Cap needs to be less than the maxTransfer Fee on destination chain id to cover for incentive amount
            maxCap: ethers.BigNumber.from(97).mul(ethers.BigNumber.from(10).pow(18)),
          },
          {
            chainId: 5,
            minCap: ethers.BigNumber.from(10).pow(18 - 2),
            // Max Cap needs to be less than the maxTransfer Fee on destination chain id to cover for incentive amount
            maxCap: ethers.BigNumber.from(97).mul(ethers.BigNumber.from(10).pow(18)),
          },
        ],
        equilibriumFee: 10000000,
        maxFee: 200000000,
        transferOverhead: 0,
        maxWalletLiquidityCap: ethers.BigNumber.from(10).pow(18 + 4),
        maxLiquidityCap: ethers.BigNumber.from(10).pow(18 + 5),
        svgHelper: await ethers.getContractFactory("AvalancheETH"),
        decimals: 18,
        rewardRatePerSecond: 100,
        rewardTokenAddress: "0xB4E0F6FEF81BdFea0856bB846789985c9CFf7e85",
      },
    ],
  };
  await deploy(config);
})();
