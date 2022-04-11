import "./aa.init";
import { describe } from "mocha";
import { BigNumber, Wallet } from "ethers";
import { expect } from "chai";
import {
  SimpleWallet,
  SimpleWallet__factory,
  EntryPoint,
  TestCounter,
  TestCounter__factory,
  TestUtil,
  TestUtil__factory,
  ERC20Token,
  ERC20Token__factory,
} from "../typechain";
import {
  AddressZero,
  createWalletOwner,
  fund,
  checkForGeth,
  rethrow,
  tostr,
  WalletConstructor,
  calcGasUsage,
  checkForBannedOps,
  ONE_ETH,
  TWO_ETH,
  deployEntryPoint,
  getBalance,
  FIVE_ETH,
  createAddress,
} from "./testutils";
import { fillAndSign, getRequestId } from "./UserOp";
import { UserOperation } from "./UserOperation";
import { PopulatedTransaction } from "ethers/lib/ethers";
import { ethers } from "hardhat";
import { parseEther } from "ethers/lib/utils";
import { debugTransaction } from "./debugTx";
import { SignerWithAddress } from "@nomiclabs/hardhat-ethers/signers";

describe("EntryPoint", function () {
  let entryPoint: EntryPoint;
  let entryPointView: EntryPoint;

  let testUtil: TestUtil;
  let walletOwner: Wallet;
  let ethersSigner: SignerWithAddress;
  let bundler: SignerWithAddress;
  let signer: string;
  let wallet: SimpleWallet;
  let token: ERC20Token;

  const globalUnstakeDelaySec = 2;
  const paymasterStake = ethers.utils.parseEther("1");

  before(async function () {
    [ethersSigner, bundler] = await ethers.getSigners();
    signer = await ethersSigner.getAddress();
    await checkForGeth();

    const chainId = await ethers.provider.getNetwork().then((net) => net.chainId);

    testUtil = await new TestUtil__factory(ethersSigner).deploy();
    entryPoint = await deployEntryPoint(paymasterStake, globalUnstakeDelaySec);

    //static call must come from address zero, to validate it can only be called off-chain.
    entryPointView = entryPoint.connect(ethers.provider.getSigner(AddressZero));
    walletOwner = createWalletOwner();
    wallet = await new SimpleWallet__factory(ethersSigner).deploy(
      entryPoint.address,
      await walletOwner.getAddress(),
      "0x0000000000000000000000000000000000000000"
    );
    await fund(wallet);

    //sanity: validate helper functions
    const sampleOp = await fillAndSign({ sender: wallet.address }, walletOwner, entryPoint);
    expect(getRequestId(sampleOp, entryPoint.address, chainId)).to.eql(await entryPoint.getRequestId(sampleOp));
  });

  it("Should perform as expected in the normal flow", async function () {
    // 1. Wallet Creation
    const salt = ethersSigner.address;
    const preAddr = await entryPoint.getSenderAddress(WalletConstructor(entryPoint.address, walletOwner.address), salt);
    await fund(preAddr);
    let createOp = await fillAndSign(
      {
        initCode: WalletConstructor(entryPoint.address, walletOwner.address),
        callGas: 1e7,
        verificationGas: 2e6,
        nonce: salt, // During contract creation, this is used as the salt. Address(deployedContract) is a function of this salt
      },
      walletOwner,
      entryPoint
    );

    expect(await ethers.provider.getCode(preAddr).then((x) => x.length)).to.equal(2, "wallet exists before creation");

    await entryPoint
      .connect(bundler)
      .handleOps([createOp], bundler.address, {
        gasLimit: 1e7,
      })
      .then((tx) => tx.wait())
      .catch(rethrow());

    const userWallet = SimpleWallet__factory.connect(preAddr, walletOwner);
    expect(await userWallet.owner()).to.equal(walletOwner.address);

    // 2. Sample Transaction Using Wallet: Call echo() on Wallet
    const echoCallData = (await userWallet.populateTransaction.echo()).data!;
    const sampleOp = await fillAndSign(
      {
        sender: userWallet.address,
        callData: (await userWallet.populateTransaction.execFromEntryPoint(userWallet.address, 0, echoCallData)).data,
      },
      walletOwner,
      entryPoint
    );
    let result = await entryPoint.connect(ethers.constants.AddressZero).callStatic.simulateValidation(sampleOp);
    console.log("Echo simulation result: ", result);
    await expect(entryPoint.connect(bundler).handleOp(sampleOp, bundler.address))
      .to.emit(userWallet, "Echo")
      .withArgs(userWallet.address);
  });
});
