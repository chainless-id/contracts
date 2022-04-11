import { ethers, run } from "hardhat";
import { defaultAbiCoder, hexConcat } from "ethers/lib/utils";
import { BigNumberish, Contract } from "ethers";
import { EntryPoint__factory } from "../typechain";
import { Create2Factory } from "../src/Create2Factory";

export async function deployEntryPoint(
  paymasterStake: BigNumberish,
  unstakeDelaySecs: BigNumberish,
  trustedForwarder: string
) {
  const [signer] = await ethers.getSigners();
  const constructorArguments = [Create2Factory.contractAddress, paymasterStake, unstakeDelaySecs, signer.address];
  const create2factory = new Create2Factory(ethers.provider);
  const epf = new EntryPoint__factory();
  const ctrParams = defaultAbiCoder.encode(["address", "uint256", "uint256", "address"], constructorArguments);
  const addr = await create2factory.deploy(hexConcat([epf.bytecode, ctrParams]), ethers.BigNumber.from(signer.address));
  const contract = EntryPoint__factory.connect(addr, signer);
  await new Promise((res, rej) => setTimeout(res, 100000));
  console.log(`EntryPoint deployed at ${addr}, owner: ${await contract.owner()}`);
  console.log(signer.address);
  //await contract.setTrustedForwarder(trustedForwarder);

  await verifyContract(addr, constructorArguments);
}
const verifyContract = async (address: string, constructorArguments: any[]) => {
  try {
    await run("verify:verify", {
      address,
      constructorArguments,
    });
  } catch (e) {
    console.log(`Failed to verify Contract ${address} `, e);
  }
};

deployEntryPoint(ethers.utils.parseEther("1"), 10, "0xE041608922d06a4F26C0d4c27d8bCD01daf1f792");
