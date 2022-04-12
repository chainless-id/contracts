import { upgradeLiquidityPool } from "./upgrade";
import { verifyImplementation } from "../helpers";
import { ethers } from "hardhat";

(async () => {
  const proxy = "0x91E39C1299F1f09954ebBA361B444bF3c8e337AE"
  const [signer] = await ethers.getSigners();
  console.log("Proxy: ", proxy, " Deployer: ", signer.address);
  console.log("Upgrading Proxy...");
  await new Promise((resolve) => setTimeout(resolve, 5000));
  await upgradeLiquidityPool(proxy);
  await verifyImplementation(proxy);
})();
