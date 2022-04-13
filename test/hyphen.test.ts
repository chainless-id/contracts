import { expect, use } from "chai";
import { Create2Factory } from "../src/Create2Factory";
import { ethers, upgrades } from "hardhat";
import {
  ERC20Token,
  LiquidityPool,
  LiquidityProvidersTest,
  ExecutorManager,
  LPToken,
  TestUtil__factory,
  WhitelistPeriodManager,
  TokenManager,
  TestUtil,
  SimpleWallet,
  SimpleWallet__factory,
  EntryPoint,
  EntryPoint__factory,
  HyphenLiquidityFarming,
  // eslint-disable-next-line node/no-missing-import
} from "../typechain";
import { SignerWithAddress } from "@nomiclabs/hardhat-ethers/signers";
import { BigNumber } from "ethers";
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

function getLocaleString(amount: number) {
  return amount.toLocaleString("fullwide", { useGrouping: false });
}

describe("LiquidityPoolTests", function () {
  let owner: SignerWithAddress, pauser: SignerWithAddress, bob: SignerWithAddress;
  let charlie: SignerWithAddress, tf: SignerWithAddress, executor: SignerWithAddress;
  let proxyAdmin: SignerWithAddress;
  let executorManager: ExecutorManager;
  let token: ERC20Token, token2: ERC20Token, token3: ERC20Token, token4: ERC20Token, liquidityPool: LiquidityPool;
  let lpToken: LPToken;
  let wlpm: WhitelistPeriodManager;
  let liquidityProviders: LiquidityProvidersTest;
  let tokenManager: TokenManager;

  let trustedForwarder = "0xFD4973FeB2031D4409fB57afEE5dF2051b171104";
  let equilibriumFee = 10000000;
  let maxFee = 200000000;
  let tokenAddress: string;
  let tag: string = "HyphenUI";

  let testUtil: TestUtil;
  let wallet: SimpleWallet;

  const NATIVE = "0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE";
  const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000";
  const minTokenCap = getLocaleString(10 * 1e18);
  const maxTokenCap = getLocaleString(200000 * 1e18);
  const minNativeTokenCap = getLocaleString(1e17);
  const maxNativeTokenCap = getLocaleString(25 * 1e18);

  const communityPerWalletMaxCap = getLocaleString(1000 * 1e18);
  const commuintyPerTokenMaxCap = getLocaleString(500000 * 1e18);
  const tokenMaxCap = getLocaleString(1000000 * 1e18);

  const communityPerWalletNativeMaxCap = getLocaleString(1 * 1e18);
  const commuintyPerTokenNativeMaxCap = getLocaleString(100 * 1e18);
  const tokenNativeMaxCap = getLocaleString(200 * 1e18);

  const DEPOSIT_EVENT = "Deposit";
  const ASSET_SENT = "AssetSent";
  const DEPOSIT_TOPIC_ID = "0x5fe47ed6d4225326d3303476197d782ded5a4e9c14f479dc9ec4992af4e85d59";
  const dummyDepositHash = "0xf408509b00caba5d37325ab33a92f6185c9b5f007a965dfbeff7b81ab1ec871a";

  let entryPoint: EntryPoint;
  let entryPointView: EntryPoint;

  beforeEach(async function () {
    [owner, pauser, charlie, bob, tf, proxyAdmin, executor] = await ethers.getSigners();

    const tokenManagerFactory = await ethers.getContractFactory("TokenManager");
    tokenManager = await tokenManagerFactory.deploy(trustedForwarder);

    const executorManagerFactory = await ethers.getContractFactory("ExecutorManager");
    executorManager = await executorManagerFactory.deploy();
    await executorManager.deployed();

    const lpTokenFactory = await ethers.getContractFactory("LPToken");
    lpToken = (await upgrades.deployProxy(lpTokenFactory, [
      "Hyphen LP Token",
      "HPT",
      trustedForwarder,
      pauser.address,
    ])) as LPToken;

    const liquidtyProvidersFactory = await ethers.getContractFactory("LiquidityProvidersTest");
    liquidityProviders = (await upgrades.deployProxy(liquidtyProvidersFactory, [
      trustedForwarder,
      lpToken.address,
      tokenManager.address,
      pauser.address,
    ])) as LiquidityProvidersTest;

    const liquidtyPoolFactory = await ethers.getContractFactory("LiquidityPool");
    liquidityPool = (await upgrades.deployProxy(liquidtyPoolFactory, [
      executorManager.address,
      await pauser.getAddress(),
      trustedForwarder,
      tokenManager.address,
      liquidityProviders.address,
    ])) as LiquidityPool;

    await liquidityPool.deployed();

    await liquidityProviders.setLiquidityPool(liquidityPool.address);

    const erc20factory = await ethers.getContractFactory("ERC20Token");
    token = (await upgrades.deployProxy(erc20factory, ["USDT", "USDT"])) as ERC20Token;
    token2 = (await upgrades.deployProxy(erc20factory, ["USDC", "USDC"])) as ERC20Token;
    token3 = (await upgrades.deployProxy(erc20factory, ["DAI", "DAI"])) as ERC20Token;
    token4 = (await upgrades.deployProxy(erc20factory, ["MIM", "MIM"])) as ERC20Token;
    tokenAddress = token.address;

    // Add supported ERC20 token
    for (const t of [token, token2, token3, token4]) {
      await tokenManager
        .connect(owner)
        .addSupportedToken(t.address, minTokenCap, maxTokenCap, equilibriumFee, maxFee, 0);

      let tokenDepositConfig = {
        min: minTokenCap,
        max: maxTokenCap,
      };
      await tokenManager.connect(owner).setDepositConfig([1], [t.address], [tokenDepositConfig]);
    }

    // Add supported Native token
    await tokenManager
      .connect(owner)
      .addSupportedToken(NATIVE, minNativeTokenCap, maxNativeTokenCap, equilibriumFee, maxFee, 0);

    let nativeDepositConfig = {
      min: minTokenCap,
      max: maxTokenCap,
    };
    await tokenManager.connect(owner).setDepositConfig([1], [NATIVE], [nativeDepositConfig]);

    await lpToken.setLiquidityProviders(liquidityProviders.address);

    const wlpmFactory = await ethers.getContractFactory("WhitelistPeriodManager");
    wlpm = (await upgrades.deployProxy(wlpmFactory, [
      trustedForwarder,
      liquidityProviders.address,
      tokenManager.address,
      lpToken.address,
      pauser.address,
    ])) as WhitelistPeriodManager;

    await wlpm.setCaps(
      [token.address, NATIVE],
      [tokenMaxCap, tokenNativeMaxCap],
      [commuintyPerTokenMaxCap, commuintyPerTokenNativeMaxCap]
    );

    await liquidityProviders.setWhiteListPeriodManager(wlpm.address);

    for (const signer of [owner, bob, charlie]) {
      for (const t of [token, token2, token3, token4]) {
        await t.mint(signer.address, ethers.BigNumber.from(100000000).mul(ethers.BigNumber.from(10).pow(18)));
      }
    }

    const globalUnstakeDelaySec = 2;
    const paymasterStake = ethers.utils.parseEther("1");
    const chainId = await ethers.provider.getNetwork().then((net) => net.chainId);

    new Create2Factory(ethers.provider).deployFactory();
    entryPoint = await new EntryPoint__factory(owner).deploy(
      Create2Factory.contractAddress,
      paymasterStake,
      globalUnstakeDelaySec,
      // ethersSigner.address
      ethers.constants.AddressZero
    );

    testUtil = await new TestUtil__factory(owner).deploy();
    // entryPoint = await deployEntryPoint(paymasterStake, globalUnstakeDelaySec);

    //static call must come from address zero, to validate it can only be called off-chain.
    entryPointView = entryPoint.connect(ethers.provider.getSigner(AddressZero));
    wallet = await new SimpleWallet__factory(owner).deploy(
      entryPoint.address,
      await charlie.getAddress(),
      "0x0000000000000000000000000000000000000000"
    );
    await fund(wallet);
  });

  async function addTokenLiquidity(tokenAddress: string, tokenValue: string, sender: SignerWithAddress) {
    let tx = await token.connect(sender).approve(liquidityProviders.address, tokenValue);
    await tx.wait();
    await liquidityProviders.connect(sender).addTokenLiquidity(tokenAddress, tokenValue);
  }

  async function addNativeLiquidity(tokenValue: string, sender: SignerWithAddress) {
    await liquidityProviders.connect(sender).addNativeLiquidity({
      value: tokenValue,
    });
  }

  async function getReceiverAddress() {
    return bob.getAddress();
  }

  async function getOwnerAddress() {
    return owner.getAddress();
  }

  async function getNonOwnerAddress() {
    return bob.getAddress();
  }

  async function getExecutorAddress() {
    return executor.getAddress();
  }

  async function depositERC20Token(tokenAddress: string, tokenValue: string, receiver: string, toChainId: number) {
    await token.approve(liquidityPool.address, tokenValue);
    return await liquidityPool.connect(owner).depositErc20(toChainId, tokenAddress, receiver, tokenValue, tag);
  }

  async function depositNative(tokenValue: string, receiver: string, toChainId: number) {
    return await liquidityPool.connect(owner).depositNative(receiver, toChainId, tag, {
      value: tokenValue,
    });
  }

  async function sendFundsToUser(
    tokenAddress: string,
    amount: string,
    receiver: string,
    tokenGasPrice: string,
    depositHash?: string
  ) {
    return await liquidityPool
      .connect(executor)
      .sendFundsToUser(
        tokenAddress,
        amount,
        receiver,
        depositHash ? depositHash : dummyDepositHash,
        tokenGasPrice,
        137
      );
  }

  async function checkStorage() {
    let isTrustedForwarderSet = await liquidityPool.isTrustedForwarder(trustedForwarder);
    let _executorManager = await liquidityPool.getExecutorManager();
    expect(isTrustedForwarderSet).to.equal(true);
    expect(_executorManager).to.equal(executorManager.address);
    expect(await liquidityPool.isPauser(await pauser.getAddress())).to.equals(true);
  }

  /*
  it("Should prevent non owners from changing token configuration", async () => {
    await expect(tokenManager.connect(bob).changeFee(token.address, 1, 1)).to.be.revertedWith(
      "Ownable: caller is not the owner"
    );
  });

  it("Should Deploy Liquidity Pool Correctly", async function () {
    expect(await liquidityPool.owner()).to.equal(owner.address);
  });

  it("Check if Pool is initialized properly", async () => {
    await checkStorage();
  });

  it("Should get ExecutorManager Address successfully", async () => {
    let executorManagerAddr = await liquidityPool.getExecutorManager();
    expect(executorManagerAddr).to.equal(executorManager.address);
  });

  describe("Trusted Forwarder Changes", async () => {
    it("Should change trustedForwarder successfully", async () => {
      let newTrustedForwarder = "0xa6389C06cD27bB7Fb87B15F33BC8702494B43e05";
      await liquidityPool.setTrustedForwarder(newTrustedForwarder);
      expect(await liquidityPool.isTrustedForwarder(newTrustedForwarder)).to.equals(true);
    });

    it("Should fail when changing trustedForwarder from non-admin account", async () => {
      let newTrustedForwarder = "0xa6389C06cD27bB7Fb87B15F33BC8702494B43e05";
      expect(liquidityPool.connect(bob).setTrustedForwarder(newTrustedForwarder)).to.be.reverted;
    });
  });

  it("Should addSupportedToken successfully", async () => {
    await tokenManager
      .connect(owner)
      .addSupportedToken(tokenAddress, minTokenCap, maxTokenCap, equilibriumFee, maxFee, 0);
    let tokenTransferConfig = await tokenManager.getTransferConfig(tokenAddress);
    let checkTokenStatus = await tokenManager.tokensInfo(tokenAddress);
    expect(checkTokenStatus.supportedToken).to.equal(true);
    expect(tokenTransferConfig.min).to.equal(minTokenCap);
    expect(tokenTransferConfig.max).to.equal(maxTokenCap);
  });

  it("Should updateTokenCap successfully", async () => {
    let newMinTokenCap = "100000";
    let newMaxTokenCap = "100000000";
    await tokenManager.connect(owner).updateTokenCap(tokenAddress, newMinTokenCap, newMaxTokenCap);

    let checkTokenStatus = await tokenManager.tokensInfo(tokenAddress);
    let tokenTransferConfig = await tokenManager.getTransferConfig(tokenAddress);
    expect(checkTokenStatus.supportedToken).to.equal(true);
    expect(tokenTransferConfig.min).to.equal(newMinTokenCap);
    expect(tokenTransferConfig.max).to.equal(newMaxTokenCap);
  });

  it("Should addNativeLiquidity successfully", async () => {
    let valueEth = ethers.utils.parseEther("1");
    await liquidityProviders.connect(owner).addNativeLiquidity({
      value: valueEth,
    });

    expect(valueEth).to.equal(await liquidityProviders.getSuppliedLiquidityByToken(NATIVE));
  });

  it("Should addTokenLiquidity successfully", async () => {
    let tokenValue = "1000000";
    let totalReserveBefore = await liquidityProviders.getTotalReserveByToken(tokenAddress);
    let tx = await token.connect(owner).approve(liquidityProviders.address, tokenValue);
    await tx.wait();
    await liquidityProviders.connect(owner).addTokenLiquidity(tokenAddress, tokenValue);
    let totalReserveAfter = await liquidityProviders.getTotalReserveByToken(tokenAddress);
    expect(totalReserveBefore.add(tokenValue).toString()).to.equal(totalReserveAfter.toString());
  });

  it("Should deposit ERC20 successfully without rewards", async () => {
    //Deposit Token
    const tokenValue = minTokenCap;
    let receiver = await getReceiverAddress();
    let toChainId = 1;
    let tokenLiquidityBefore = (await token.balanceOf(liquidityPool.address)).toString();
    let tx = await depositERC20Token(tokenAddress, tokenValue, receiver, toChainId);

    expect(tx)
      .to.emit(liquidityPool, DEPOSIT_EVENT)
      .withArgs(await getOwnerAddress(), tokenAddress, receiver, toChainId, tokenValue, 0, tag);
    let tokenLiquidityAfter = (await token.balanceOf(liquidityPool.address)).toString();
    expect(parseInt(tokenLiquidityAfter)).to.equal(parseInt(tokenLiquidityBefore) + parseInt(tokenValue));
  });

  it("Should not get reward during deposit if current liquidity = provided liquidity", async () => {
    const tokenValue = minTokenCap;
    let receiver = await getReceiverAddress();
    let toChainId = 1;
    await addTokenLiquidity(tokenAddress, tokenValue, owner);
    let rewardAmout = await liquidityPool.getRewardAmount(tokenValue, tokenAddress);
    expect(rewardAmout).to.equals(0);
    let tx = await depositERC20Token(tokenAddress, tokenValue, receiver, toChainId);
    expect(tx)
      .to.emit(liquidityPool, DEPOSIT_EVENT)
      .withArgs(await getOwnerAddress(), tokenAddress, receiver, toChainId, tokenValue, 0, tag);
  });

  it("Should not get reward during deposit if current liquidity > provided liquidity", async () => {
    const tokenValue = minTokenCap;
    let receiver = await getReceiverAddress();
    let toChainId = 1;
    await addTokenLiquidity(tokenAddress, tokenValue, owner);
    // Deposit once so current liquidity becomes more than provided liquidity
    await depositERC20Token(tokenAddress, minTokenCap, receiver, toChainId);

    let rewardAmout = await liquidityPool.getRewardAmount(tokenValue, tokenAddress);
    expect(rewardAmout).to.equals(0);
    let tx = await depositERC20Token(tokenAddress, tokenValue, receiver, toChainId);
    expect(tx)
      .to.emit(liquidityPool, DEPOSIT_EVENT)
      .withArgs(await getOwnerAddress(), tokenAddress, receiver, toChainId, tokenValue, 0, tag);
  });

  describe("Should get reward during deposit", () => {
    it("Current liquidity < Provided liquidity and pool remains in deficit state after deposit", async () => {
      const liquidityToBeAdded = getLocaleString(2 * 1e2 * 1e18);
      const amountToWithdraw = BigNumber.from(minTokenCap).add(1).toString();
      const amountToDeposit = minTokenCap;
      let receiver = await getReceiverAddress();
      let toChainId = 1;

      await addTokenLiquidity(tokenAddress, liquidityToBeAdded, owner);
      await executorManager.addExecutor(executor.address);
      // Send funds to put pool into deficit state so current liquidity < provided liquidity
      let tx = await sendFundsToUser(tokenAddress, amountToWithdraw, receiver, "0");
      await tx.wait();
      let rewardAmoutFromContract = await liquidityPool.getRewardAmount(amountToDeposit, tokenAddress);
      let incentivePoolAmount = await liquidityPool.incentivePool(tokenAddress);
      let equilibriumLiquidity = await liquidityProviders.getSuppliedLiquidityByToken(tokenAddress);
      let currentBalance = await token.balanceOf(liquidityPool.address);
      let gasFeeAccumulated = await liquidityPool.gasFeeAccumulatedByToken(tokenAddress);
      // TODO: Update this test case
      let lpFeeAccumulated = await liquidityProviders.getTotalLPFeeByToken(tokenAddress);

      let currentLiquidity = currentBalance.sub(gasFeeAccumulated).sub(lpFeeAccumulated).sub(incentivePoolAmount);
      let calculatedRewardAmount = BigNumber.from(amountToDeposit)
        .mul(incentivePoolAmount)
        .div(equilibriumLiquidity.sub(currentLiquidity));

      expect(calculatedRewardAmount).to.equals(rewardAmoutFromContract);

      let depositTx = await depositERC20Token(tokenAddress, amountToDeposit, receiver, toChainId);
      expect(depositTx)
        .to.emit(liquidityPool, DEPOSIT_EVENT)
        .withArgs(
          await getOwnerAddress(),
          tokenAddress,
          receiver,
          toChainId,
          calculatedRewardAmount.add(amountToDeposit).toString(),
          calculatedRewardAmount,
          tag
        );
    });

    it("Current liquidity < Provided liquidity and pool goes into excess state after deposit", async () => {
      const liquidityToBeAdded = getLocaleString(2 * 1e2 * 1e18);
      const amountToWithdraw = BigNumber.from(minTokenCap).add(1).toString();
      const amountToDeposit = BigNumber.from(minTokenCap).add(minTokenCap).toString();
      let receiver = await getReceiverAddress();
      let toChainId = 1;

      await addTokenLiquidity(tokenAddress, liquidityToBeAdded, owner);
      await executorManager.addExecutor(executor.address);

      // Send funds to put pool into deficit state so current liquidity < provided liquidity
      let tx = await sendFundsToUser(tokenAddress, amountToWithdraw, receiver, "0");
      await tx.wait();
      let rewardAmoutFromContract = await liquidityPool.getRewardAmount(amountToDeposit, tokenAddress);
      let incentivePoolAmount = await liquidityPool.incentivePool(tokenAddress);
      let calculatedRewardAmount = incentivePoolAmount;

      expect(calculatedRewardAmount).to.equals(rewardAmoutFromContract);

      let depositTx = await depositERC20Token(tokenAddress, amountToDeposit, receiver, toChainId);
      expect(depositTx)
        .to.emit(liquidityPool, DEPOSIT_EVENT)
        .withArgs(
          await getOwnerAddress(),
          tokenAddress,
          receiver,
          toChainId,
          calculatedRewardAmount.add(amountToDeposit).toString(),
          calculatedRewardAmount,
          tag
        );
    });

    it("Real world use case for Native currency, when deposit gets all incentive pool", async () => {
      // Add Native Currency liquidity
      const liquidityToBeAdded = getLocaleString(50 * 1e18);
      await addNativeLiquidity(liquidityToBeAdded, owner);

      const amountToWithdraw = BigNumber.from(minTokenCap).toString();
      let receiver = await getReceiverAddress();
      let toChainId = 1;
      await executorManager.addExecutor(executor.address);
      // Send funds to put pool into deficit state so current liquidity < provided liquidity
      let tx = await sendFundsToUser(NATIVE, amountToWithdraw, receiver, "0");
      await tx.wait();

      const amountToDeposit = BigNumber.from(minTokenCap)
        .add(BigNumber.from(getLocaleString(5 * 1e18)))
        .toString();

      let rewardAmoutFromContract = await liquidityPool.getRewardAmount(amountToDeposit, NATIVE);
      let incentivePoolAmount = await liquidityPool.incentivePool(NATIVE);

      let calculatedRewardAmount = incentivePoolAmount;

      expect(calculatedRewardAmount).to.equals(rewardAmoutFromContract);

      let depositTx = await depositNative(amountToDeposit, receiver, toChainId);

      expect(depositTx)
        .to.emit(liquidityPool, DEPOSIT_EVENT)
        .withArgs(
          await getOwnerAddress(),
          NATIVE,
          receiver,
          toChainId,
          calculatedRewardAmount.add(amountToDeposit).toString(),
          calculatedRewardAmount,
          tag
        );
    });

    it("Real world use case for Native currency, when deposit gets some part of incentive pool", async () => {
      // Add Native Currency liquidity
      const liquidityToBeAdded = getLocaleString(50 * 1e18);
      await addNativeLiquidity(liquidityToBeAdded, owner);

      const amountToWithdraw = BigNumber.from(minTokenCap)
        .add(BigNumber.from(getLocaleString(5 * 1e18)))
        .toString();
      let receiver = await getReceiverAddress();
      let toChainId = 1;
      await executorManager.addExecutor(executor.address);
      // Send funds to put pool into deficit state so current liquidity < provided liquidity
      let tx = await sendFundsToUser(NATIVE, amountToWithdraw, receiver, "0");
      await tx.wait();

      let rewardPoolBeforeTransfer = await liquidityPool.incentivePool(NATIVE);
      tx = await sendFundsToUser(
        NATIVE,
        amountToWithdraw,
        receiver,
        "0",
        "0xbf4d8d58e7905ad39ea2e4b8c8ae0cae89e5877d8540b03a299a0b14544c1e6a"
      );
      await tx.wait();

      const amountToDeposit = BigNumber.from(minTokenCap).toString();

      let rewardAmoutFromContract = await liquidityPool.getRewardAmount(amountToDeposit, NATIVE);
      let incentivePoolAmount = await liquidityPool.incentivePool(NATIVE);
      let equilibriumLiquidity = await liquidityProviders.getSuppliedLiquidityByToken(NATIVE);

      let currentBalance = await ethers.provider.getBalance(liquidityPool.address);

      let gasFeeAccumulated = await liquidityPool.gasFeeAccumulatedByToken(NATIVE);

      // TODO: Update this test case
      let lpFeeAccumulated = await liquidityProviders.getTotalLPFeeByToken(NATIVE);

      let currentLiquidity = currentBalance.sub(gasFeeAccumulated).sub(lpFeeAccumulated).sub(incentivePoolAmount);

      let currrentLiquidityFromContract = await liquidityPool.getCurrentLiquidity(NATIVE);
      expect(currentLiquidity).to.equals(currrentLiquidityFromContract);

      let calculatedRewardAmount = BigNumber.from(amountToDeposit)
        .mul(incentivePoolAmount)
        .div(equilibriumLiquidity.sub(currentLiquidity));
      expect(calculatedRewardAmount).to.equals(rewardAmoutFromContract);

      let depositTx = await depositNative(amountToDeposit, receiver, toChainId);

      expect(depositTx)
        .to.emit(liquidityPool, DEPOSIT_EVENT)
        .withArgs(
          await getOwnerAddress(),
          NATIVE,
          receiver,
          toChainId,
          calculatedRewardAmount.add(amountToDeposit).toString(),
          calculatedRewardAmount,
          tag
        );
    });

    it("Sending funds to user should increase the incentive pool", async () => {
      // Add Native Currency liquidity
      const liquidityToBeAdded = getLocaleString(50 * 1e18);
      await addNativeLiquidity(liquidityToBeAdded, owner);

      const amountToWithdraw = BigNumber.from(minTokenCap).add(BigNumber.from(getLocaleString(5 * 1e18)));
      let receiver = await getReceiverAddress();
      let toChainId = 1;
      await executorManager.addExecutor(executor.address);
      // Send funds to put pool into deficit state so current liquidity < provided liquidity
      let tx = await sendFundsToUser(NATIVE, amountToWithdraw.toString(), receiver, "0");
      await tx.wait();

      let rewardPoolBeforeTransfer = await liquidityPool.incentivePool(NATIVE);

      let transferFeePercentage = await liquidityPool.getTransferFee(NATIVE, amountToWithdraw);

      let excessFeePercentage = transferFeePercentage.sub(BigNumber.from("10000000"));
      let expectedRewardAmount = amountToWithdraw.mul(excessFeePercentage).div(1e10);
      tx = await sendFundsToUser(
        NATIVE,
        amountToWithdraw.toString(),
        receiver,
        "0",
        "0xbf4d8d58e7905ad39ea2e4b8c8ae0cae89e5877d8540b03a299a0b14544c1e6a"
      );

      let rewardPoolAfterTrasnfer = await liquidityPool.incentivePool(NATIVE);

      let rewardPoolDiff = rewardPoolAfterTrasnfer.sub(rewardPoolBeforeTransfer);
      expect(rewardPoolDiff.eq(expectedRewardAmount)).to.be.true;
    });
  });

  it("Should depositNative successfully", async () => {
    const tokenValue = minTokenCap;
    const tokenLiquidityBefore = await ethers.provider.getBalance(liquidityPool.address);

    //Deposit Native
    await liquidityPool.connect(owner).depositNative(await getReceiverAddress(), 1, tag, {
      value: tokenValue,
    });
    const tokenLiquidityAfter = await ethers.provider.getBalance(liquidityPool.address);

    expect(parseInt(tokenLiquidityAfter.toString())).to.equal(
      parseInt(tokenLiquidityBefore.toString()) + parseInt(tokenValue)
    );
  });

  it("Should setTokenTransferOverhead successfully", async () => {
    let gasOverhead = "21110";
    await tokenManager.connect(owner).setTokenTransferOverhead(tokenAddress, 21110);
    let checkTokenGasOverhead = await tokenManager.tokensInfo(tokenAddress);
    expect(checkTokenGasOverhead.transferOverhead).to.equal(gasOverhead);
  });

  // (node:219241) UnhandledPromiseRejectionWarning: Error: VM Exception while processing transaction: revert SafeMath: subtraction overflow
  it("Should send ERC20 funds to user successfully", async () => {
    await addTokenLiquidity(tokenAddress, minTokenCap, owner);
    const amount = minTokenCap;
    const usdtBalanceBefore = await token.balanceOf(liquidityPool.address);
    const suppliedLiquidity = await liquidityProviders.getSuppliedLiquidityByToken(tokenAddress);
    await executorManager.connect(owner).addExecutor(await executor.getAddress());

    let transferFeeFromContract = await liquidityPool.getTransferFee(tokenAddress, amount);
    await liquidityPool
      .connect(executor)
      .sendFundsToUser(token.address, amount.toString(), await getReceiverAddress(), dummyDepositHash, 0, 137);

    let equilibriumLiquidity = suppliedLiquidity;
    let resultingLiquidity = usdtBalanceBefore.sub(amount);
    let numerator = suppliedLiquidity.mul(maxFee * equilibriumFee);
    let denominator = equilibriumLiquidity.mul(equilibriumFee).add(resultingLiquidity.mul(maxFee - equilibriumFee));
    let transferFee = numerator.div(denominator);

    let estimatedValueTransferred = BigNumber.from(amount).sub(transferFee.mul(amount).div(10000000000));
    const usdtBalanceAfter = await token.balanceOf(liquidityPool.address);
    expect(transferFeeFromContract).to.equals(transferFee);
    expect(usdtBalanceBefore.sub(estimatedValueTransferred)).to.equal(usdtBalanceAfter);
  });

  it("Should fail to send ERC20 funds to user: Already Processed", async () => {
    const amount = 1000000;
    const dummyDepositHash = "0xf408509b00caba5d37325ab33a92f6185c9b5f007a965dfbeff7b81ab1ec871a";
    await executorManager.connect(owner).addExecutor(await executor.getAddress());

    await expect(
      liquidityPool
        .connect(executor)
        .sendFundsToUser(token.address, amount.toString(), await getReceiverAddress(), dummyDepositHash, 0, 137)
    ).to.be.reverted;
  });

  it("Should fail to send ERC20 funds to user: not Authorised", async () => {
    const dummyDepositHash = "0xf408509b00caba5d37325ab33a92f6185c9b5f007a965dfbeff7b81ab1ec871a";
    await executorManager.connect(owner).addExecutor(await executor.getAddress());
    await expect(
      liquidityPool
        .connect(bob)
        .sendFundsToUser(token.address, "1000000", await getReceiverAddress(), dummyDepositHash, 0, 137)
    ).to.be.reverted;
  });

  it("Should fail to send ERC20 funds to user: receiver cannot be Zero", async () => {
    const dummyDepositHash = "0xf408509b00caba5d37325ab33a92f6185c9b5f007a965dfbeff7b81ab1ec871a";
    await executorManager.connect(owner).addExecutors([await executor.getAddress()]);
    await expect(
      liquidityPool.connect(executor).sendFundsToUser(token.address, "1000000", ZERO_ADDRESS, dummyDepositHash, 0, 137)
    ).to.be.reverted;
  });

  it("Should add new ExecutorManager Address successfully", async () => {
    let newExecutorManager = await bob.getAddress();
    await liquidityPool.connect(owner).setExecutorManager(newExecutorManager);
    let newExecutorManagerAddr = await liquidityPool.getExecutorManager();
    expect(newExecutorManager).to.equal(newExecutorManagerAddr);
  });

  it("Should fail to set new ExecutorManager : only owner can set", async () => {
    let newExecutorManager = await bob.getAddress();
    await expect(liquidityPool.connect(bob).setExecutorManager(newExecutorManager)).be.reverted;
  });

  it("Should fail to addSupportedToken: only owner can add", async () => {
    let minTokenCap = "100000000";
    let maxTokenCap = "10000000000";
    await expect(
      tokenManager.connect(bob).addSupportedToken(tokenAddress, minTokenCap, maxTokenCap, equilibriumFee, maxFee, 0)
    ).to.be.reverted;
  });

  it("Should fail to addSupportedToken: min cap should be less than max cap", async () => {
    let minTokenCap = "10000000000";
    let maxTokenCap = "100000000";
    await expect(
      tokenManager.connect(bob).addSupportedToken(tokenAddress, minTokenCap, maxTokenCap, equilibriumFee, maxFee, 0)
    ).to.be.reverted;
  });

  it("Should fail to addSupportedToken: token address can't be 0'", async () => {
    let minTokenCap = "10000000000";
    let maxTokenCap = "100000000";
    await expect(
      tokenManager.connect(bob).addSupportedToken(ZERO_ADDRESS, minTokenCap, maxTokenCap, equilibriumFee, maxFee, 0)
    ).to.be.reverted;
  });

  it("Should fail to removeSupportedToken: Only owner can remove supported tokens", async () => {
    await expect(tokenManager.connect(bob).removeSupportedToken(tokenAddress)).to.be.reverted;
  });

  it("Should fail to updateTokenCap: TokenAddress not supported", async () => {
    let minTokenCap = "100000000";
    let maxTokenCap = "10000000000";
    let inactiveTokenAddress = await bob.getAddress();
    await expect(tokenManager.connect(owner).updateTokenCap(inactiveTokenAddress, minTokenCap, maxTokenCap)).to.be
      .reverted;
  });

  it("Should fail to updateTokenCap: TokenAddress can't be 0", async () => {
    let minTokenCap = "100000000";
    let maxTokenCap = "10000000000";
    await expect(tokenManager.connect(owner).updateTokenCap(ZERO_ADDRESS, minTokenCap, maxTokenCap)).to.be.reverted;
  });

  it("Should fail to updateTokenCap: only owner can update", async () => {
    let minTokenCap = "100000000";
    let maxTokenCap = "10000000000";
    await expect(tokenManager.connect(bob).updateTokenCap(tokenAddress, minTokenCap, maxTokenCap)).to.be.reverted;
  });

  it("Should fail to depositErc20: Token address cannot be 0", async () => {
    await expect(
      liquidityPool.connect(owner).depositErc20(ZERO_ADDRESS, await getNonOwnerAddress(), "100000000", 1, tag)
    ).to.be.reverted;
  });

  it("Should fail to depositErc20: Token not supported", async () => {
    let inactiveTokenAddress = await bob.getAddress();
    await expect(
      liquidityPool.connect(owner).depositErc20(137, inactiveTokenAddress, await getNonOwnerAddress(), "100000000", tag)
    ).to.be.reverted;
  });

  it("Should fail to depositErc20: Deposit amount below allowed min Cap limit", async () => {
    await expect(
      liquidityPool.connect(owner).depositErc20(1, tokenAddress, await getNonOwnerAddress(), "200000000000", tag)
    ).to.be.reverted;
  });

  it("Should fail to depositErc20: Deposit amount exceeds allowed max Cap limit", async () => {
    await expect(liquidityPool.connect(owner).depositErc20(tokenAddress, await getNonOwnerAddress(), "20", 1, tag)).to
      .be.reverted;
  });

  it("Should fail to depositErc20: Receiver address cannot be 0", async () => {
    await expect(liquidityPool.connect(owner).depositErc20(1, tokenAddress, ZERO_ADDRESS, "1000000", tag)).to.be
      .reverted;
  });

  it("Should fail to depositErc20: amount should be greater then 0", async () => {
    await expect(liquidityPool.connect(owner).depositErc20(1, tokenAddress, await getNonOwnerAddress(), "0", tag)).to.be
      .reverted;
  });

  it("Should fail to setTokenTransferOverhead: TokenAddress not supported", async () => {
    let inactiveTokenAddress = await bob.getAddress();
    await expect(tokenManager.connect(owner).setTokenTransferOverhead(inactiveTokenAddress, 21110)).to.be.revertedWith(
      "Token not supported"
    );
  });

  it("Should fail to setTokenTransferOverhead: only owner can update", async () => {
    await expect(tokenManager.connect(bob).setTokenTransferOverhead(tokenAddress, 21110)).to.be.reverted;
  });

  it("Should removeSupportedToken successfully", async () => {
    await tokenManager.connect(owner).removeSupportedToken(tokenAddress);

    let checkTokenStatus = await tokenManager.tokensInfo(tokenAddress);
    expect(checkTokenStatus.supportedToken).to.equal(false);
  });

  it("Should allow withdrawl of token gas fee", async () => {
    await addTokenLiquidity(tokenAddress, minTokenCap, owner);
    const amount = minTokenCap;
    await executorManager.connect(owner).addExecutor(await executor.getAddress());

    await liquidityPool
      .connect(executor)
      .sendFundsToUser(token.address, amount.toString(), await getReceiverAddress(), dummyDepositHash, 1, 137);

    const gasFeeAccumulated = await liquidityPool.gasFeeAccumulated(token.address, executor.address);
    expect(gasFeeAccumulated.gt(0)).to.be.true;

    await expect(() => liquidityPool.connect(executor).withdrawErc20GasFee(token.address)).to.changeTokenBalances(
      token,
      [liquidityPool, executor],
      [-gasFeeAccumulated, gasFeeAccumulated]
    );
  });

  it("Should allow withdrawl of native gas fee", async () => {
    await addNativeLiquidity(minTokenCap, owner);
    const amount = minTokenCap;
    await executorManager.connect(owner).addExecutor(await executor.getAddress());

    await liquidityPool
      .connect(executor)
      .sendFundsToUser(NATIVE, amount.toString(), await getReceiverAddress(), dummyDepositHash, 1, 137);

    const gasFeeAccumulated = await liquidityPool.gasFeeAccumulated(NATIVE, executor.address);
    expect(gasFeeAccumulated.gt(0)).to.be.true;

    await expect(() => liquidityPool.connect(executor).withdrawNativeGasFee()).to.changeEtherBalances(
      [liquidityPool, executor],
      [-gasFeeAccumulated, gasFeeAccumulated]
    );
  });

  it("Should revert on re-entrant calls to transfer", async function () {
    const maliciousContract = await (
      await ethers.getContractFactory("LiquidityProvidersMaliciousReentrant")
    ).deploy(liquidityPool.address);
    await addNativeLiquidity(ethers.BigNumber.from(10).pow(20).toString(), owner);
    await liquidityPool.setLiquidityProviders(maliciousContract.address);

    await expect(
      owner.sendTransaction({
        to: maliciousContract.address,
        value: 1,
      })
    ).to.be.reverted;
  });
   */

  /*
  it("Should process multi token deposits", async function () {
    const toTokenUnits = (amount: number) => ethers.BigNumber.from(10).pow(19).mul(amount);
    for (const t of [token, token2, token3, token4]) {
      t.approve(liquidityPool.address, ethers.constants.MaxUint256);
    }

    await expect(() =>
      liquidityPool.multiTokenDeposit(
        1,
        [token.address, token2.address, token3.address, token4.address],
        owner.address,
        [toTokenUnits(1), toTokenUnits(2), toTokenUnits(3), toTokenUnits(4)],
        "",
        ["USDC", "USDT"],
        [20, 80]
      )
    ).to.changeTokenBalances(token, [liquidityPool, owner], [toTokenUnits(1), toTokenUnits(-1)]);

    await expect(() =>
      liquidityPool.multiTokenDeposit(
        1,
        [token.address, token2.address, token3.address, token4.address],
        owner.address,
        [toTokenUnits(1), toTokenUnits(2), toTokenUnits(3), toTokenUnits(4)],
        "",
        ["USDC", "USDT"],
        [20, 80]
      )
    ).to.changeTokenBalances(token2, [liquidityPool, owner], [toTokenUnits(2), toTokenUnits(-2)]);

    await expect(() =>
      liquidityPool.multiTokenDeposit(
        1,
        [token.address, token2.address, token3.address, token4.address],
        owner.address,

        [toTokenUnits(1), toTokenUnits(2), toTokenUnits(3), toTokenUnits(4)],
        "",
        ["USDC", "USDT"],
        [20, 80]
      )
    ).to.changeTokenBalances(token3, [liquidityPool, owner], [toTokenUnits(3), toTokenUnits(-3)]);

    await expect(() =>
      liquidityPool.multiTokenDeposit(
        1,
        [token.address, token2.address, token3.address, token4.address],
        owner.address,
        [toTokenUnits(1), toTokenUnits(2), toTokenUnits(3), toTokenUnits(4)],
        "",
        ["USDC", "USDT"],
        [20, 80]
      )
    ).to.changeTokenBalances(token4, [liquidityPool, owner], [toTokenUnits(4), toTokenUnits(-4)]);

    await expect(
      liquidityPool.multiTokenDeposit(
        1,
        [token.address, token2.address, token3.address, token4.address],
        owner.address,
        [toTokenUnits(1), toTokenUnits(2), toTokenUnits(3), toTokenUnits(4)],
        "",
        ["USDC", "USDT"],
        [20, 80]
      )
    )
      .to.emit(liquidityPool, "MultiDeposit")
      .withArgs(
        owner.address,
        [token.address, token2.address, token3.address, token4.address],
        owner.address,
        1,
        [toTokenUnits(1), toTokenUnits(2), toTokenUnits(3), toTokenUnits(4)],
        [0, 0, 0, 0],
        "",
        ["USDC", "USDT"],
        [20, 80]
      );
  });
  */

  it("Should process deposits via wallet", async function () {
    // 1. Wallet Creation
    const salt = owner.address;
    const preAddr = await entryPoint.getSenderAddress(WalletConstructor(entryPoint.address, charlie.address), salt);
    await fund(preAddr);
    let createOp = await fillAndSign(
      {
        initCode: WalletConstructor(entryPoint.address, charlie.address),
        callGas: 1e7,
        verificationGas: 2e6,
        nonce: salt, // During contract creation, this is used as the salt. Address(deployedContract) is a function of this salt
      },
      charlie,
      entryPoint
    );

    expect(await ethers.provider.getCode(preAddr).then((x) => x.length)).to.equal(2, "wallet exists before creation");

    await entryPoint
      .connect(bob)
      .handleOps([createOp], bob.address, {
        gasLimit: 1e7,
      })
      .then((tx) => tx.wait())
      .catch(rethrow());

    const userWallet = SimpleWallet__factory.connect(preAddr, charlie);
    expect(await userWallet.owner()).to.equal(charlie.address);

    await token.connect(charlie).transfer(userWallet.address, ethers.utils.parseEther("1000"));
    await token2.connect(charlie).transfer(userWallet.address, ethers.utils.parseEther("1000"));
    await token3.connect(charlie).transfer(userWallet.address, ethers.utils.parseEther("1000"));
    await token4.connect(charlie).transfer(userWallet.address, ethers.utils.parseEther("1000"));
    await charlie.sendTransaction({
      to: userWallet.address,
      value: ethers.utils.parseEther("100"),
    });

    const toTokenUnits = (amount: number) => ethers.BigNumber.from(10).pow(19).mul(amount);

    // 2. Sample Transaction Using Wallet: Call echo() on Wallet
    let transferCallData = (
      await userWallet.populateTransaction.transferViaHyphen(
        liquidityPool.address,
        [NATIVE, token.address],
        [toTokenUnits(1), toTokenUnits(1)],
        ["USDT"],
        [10000],
        1
      )
    ).data!;
    let sampleOp = await fillAndSign(
      {
        sender: userWallet.address,
        callData: (
          await userWallet.populateTransaction.execFromEntryPoint(userWallet.address, 0, transferCallData)
        ).data,
      },
      charlie,
      entryPoint
    );
    let result = await entryPoint.connect(ethers.constants.AddressZero).callStatic.simulateValidation(sampleOp);
    console.log("Echo simulation result: ", result);

    await expect(
      async () =>
        await entryPoint.connect(bob).handleOp(sampleOp, bob.address, {
          gasLimit: 30000000,
        })
    ).to.changeTokenBalances(token, [userWallet, liquidityPool], [toTokenUnits(-1), toTokenUnits(1)]);

    // Round 2
    console.log(await ethers.provider.getBalance(userWallet.address));
    transferCallData = (
      await userWallet.populateTransaction.transferViaHyphen(
        liquidityPool.address,
        [NATIVE, token.address],
        [toTokenUnits(1), toTokenUnits(1)],
        ["USDT"],
        [10000],
        1
      )
    ).data!;
    sampleOp = await fillAndSign(
      {
        sender: userWallet.address,
        callData: (
          await userWallet.populateTransaction.execFromEntryPoint(userWallet.address, 0, transferCallData)
        ).data,
      },
      charlie,
      entryPoint
    );

    console.log(sampleOp)
    
    result = await entryPoint.connect(ethers.constants.AddressZero).callStatic.simulateValidation(sampleOp);
    console.log("Echo simulation result: ", result);
    await expect(
      async () =>
        await entryPoint.connect(bob).handleOp(sampleOp, bob.address, {
          gasLimit: 30000000,
        })
    ).to.changeEtherBalances([userWallet, liquidityPool], [toTokenUnits(-1), toTokenUnits(1)]);
  });
});
