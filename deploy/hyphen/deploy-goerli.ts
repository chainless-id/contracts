import { ethers } from "hardhat";
import { deploy, IDeployConfig } from "./helpers";

(async () => {
  const config: IDeployConfig = {
    trustedForwarder: "0xE041608922d06a4F26C0d4c27d8bCD01daf1f792",
    bicoOwner: "0xCEF0a0CD0921fBa39A833D8Ab1F090F341ef03b6",
    pauser: "0xCEF0a0CD0921fBa39A833D8Ab1F090F341ef03b6",
    tokens: [
      {
        tokenAddress: "0x64ef393b6846114bad71e2cb2ccc3e10736b5716",
        minCap: ethers.BigNumber.from(10).pow(18 + 2),
        maxCap: ethers.BigNumber.from(10).pow(18 + 4),
        depositConfigs: [
          {
            chainId: 43113,
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
        svgHelper: await ethers.getContractFactory("EthereumUSDT"),
        decimals: 18,
        rewardRatePerSecond: 100,
        rewardTokenAddress: "0x64ef393b6846114bad71e2cb2ccc3e10736b5716",
      },
      {
        tokenAddress: "0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE",
        minCap: ethers.BigNumber.from(10).pow(18 - 2),
        maxCap: ethers.BigNumber.from(10).pow(18 + 2),
        depositConfigs: [
          {
            chainId: 43113,
            minCap: ethers.BigNumber.from(10).pow(18 - 2),
            // Max Cap needs to be less than the maxTransfer Fee on destination chain id to cover for incentive amount
            maxCap: ethers.BigNumber.from(97).mul(ethers.BigNumber.from(10).pow(18)),
          },
          {
            chainId: 80001,
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
        svgHelper: await ethers.getContractFactory("EthereumETH"),
        decimals: 18,
        rewardRatePerSecond: 100,
        rewardTokenAddress: "0x64ef393b6846114bad71e2cb2ccc3e10736b5716",
      },
      {
        tokenAddress: "0xb5B640E6414b6DeF4FC9B3C1EeF373925effeCcF",
        minCap: ethers.BigNumber.from(10).pow(6 + 2),
        maxCap: ethers.BigNumber.from(10).pow(6 + 4),
        depositConfigs: [
          {
            chainId: 80001,
            minCap: ethers.BigNumber.from(10).pow(6 + 2),
            // Max Cap needs to be less than the maxTransfer Fee on destination chain id to cover for incentive amount
            maxCap: ethers.BigNumber.from(9).mul(ethers.BigNumber.from(10).pow(6 + 3)),
          },
        ],
        equilibriumFee: 10000000,
        maxFee: 200000000,
        transferOverhead: 0,
        maxWalletLiquidityCap: ethers.BigNumber.from(10).pow(6 + 4),
        maxLiquidityCap: ethers.BigNumber.from(10).pow(6 + 5),
        svgHelper: await ethers.getContractFactory("EthereumUSDC"),
        decimals: 6,
        rewardRatePerSecond: 100,
        rewardTokenAddress: "0x64ef393b6846114bad71e2cb2ccc3e10736b5716",
      },
    ],
  };
  await deploy(config);
})();
