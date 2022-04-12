// $$\   $$\                     $$\                                 $$$$$$$\                      $$\
// $$ |  $$ |                    $$ |                                $$  __$$\                     $$ |
// $$ |  $$ |$$\   $$\  $$$$$$\  $$$$$$$\   $$$$$$\  $$$$$$$\        $$ |  $$ | $$$$$$\   $$$$$$\  $$ |
// $$$$$$$$ |$$ |  $$ |$$  __$$\ $$  __$$\ $$  __$$\ $$  __$$\       $$$$$$$  |$$  __$$\ $$  __$$\ $$ |
// $$  __$$ |$$ |  $$ |$$ /  $$ |$$ |  $$ |$$$$$$$$ |$$ |  $$ |      $$  ____/ $$ /  $$ |$$ /  $$ |$$ |
// $$ |  $$ |$$ |  $$ |$$ |  $$ |$$ |  $$ |$$   ____|$$ |  $$ |      $$ |      $$ |  $$ |$$ |  $$ |$$ |
// $$ |  $$ |\$$$$$$$ |$$$$$$$  |$$ |  $$ |\$$$$$$$\ $$ |  $$ |      $$ |      \$$$$$$  |\$$$$$$  |$$ |
// \__|  \__| \____$$ |$$  ____/ \__|  \__| \_______|\__|  \__|      \__|       \______/  \______/ \__|
//           $$\   $$ |$$ |
//           \$$$$$$  |$$ |
//            \______/ \__|
//
// SPDX-License-Identifier: MIT

pragma solidity 0.8.0;
pragma abicoder v2;

import "@openzeppelin/contracts-upgradeable/proxy/utils/Initializable.sol";
import "@openzeppelin/contracts-upgradeable/access/OwnableUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/security/ReentrancyGuardUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/token/ERC20/utils/SafeERC20Upgradeable.sol";
import "@openzeppelin/contracts-upgradeable/token/ERC20/IERC20Upgradeable.sol";
import "./metatx/ERC2771ContextUpgradeable.sol";
import "../security/Pausable.sol";
import "./structures/TokenConfig.sol";
import "./interfaces/IExecutorManager.sol";
import "./interfaces/ILiquidityProviders.sol";
import "../interfaces/IERC20Permit.sol";
import "./interfaces/ITokenManager.sol";

contract LiquidityPool is
    Initializable,
    ReentrancyGuardUpgradeable,
    Pausable,
    OwnableUpgradeable,
    ERC2771ContextUpgradeable
{
    address private constant NATIVE =
        0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE;
    uint256 private constant BASE_DIVISOR = 10000000000; // Basis Points * 100 for better accuracy

    uint256 public baseGas;

    IExecutorManager private executorManager;
    ITokenManager public tokenManager;
    ILiquidityProviders public liquidityProviders;

    struct PermitRequest {
        uint256 nonce;
        uint256 expiry;
        bool allowed;
        uint8 v;
        bytes32 r;
        bytes32 s;
    }

    mapping(bytes32 => bool) public processedHash;
    mapping(address => uint256) public gasFeeAccumulatedByToken;

    // Gas fee accumulated by token address => executor address
    mapping(address => mapping(address => uint256)) public gasFeeAccumulated;

    // Incentive Pool amount per token address
    mapping(address => uint256) public incentivePool;

    event AssetSent(
        address indexed asset,
        uint256 indexed amount,
        uint256 indexed transferredAmount,
        address target,
        bytes depositHash,
        uint256 fromChainId,
        uint256 lpFee,
        uint256 transferFee,
        uint256 gasFee
    );
    event Received(address indexed from, uint256 indexed amount);
    event Deposit(
        address indexed from,
        address indexed tokenAddress,
        address indexed receiver,
        uint256 toChainId,
        uint256 amount,
        uint256 reward,
        string tag
    );
    event MultiDeposit(
        address from,
        address[] tokenAddresses,
        address receiver,
        uint256 toChainId,
        uint256[] amounts,
        uint256[] reward,
        string tag,
        string[] targetTokens,
        uint256[] targetTokenPercentageAllocation
    );
    event GasFeeWithdraw(
        address indexed tokenAddress,
        address indexed owner,
        uint256 indexed amount
    );
    event TrustedForwarderChanged(address indexed forwarderAddress);
    event LiquidityProvidersChanged(address indexed liquidityProvidersAddress);
    event TokenManagerChanged(address indexed tokenManagerAddress);
    event EthReceived(address, uint256);

    // MODIFIERS
    modifier onlyExecutor() {
        require(
            executorManager.getExecutorStatus(_msgSender()),
            "Only executor is allowed"
        );
        _;
    }

    modifier onlyLiquidityProviders() {
        require(
            _msgSender() == address(liquidityProviders),
            "Only liquidityProviders is allowed"
        );
        _;
    }

    modifier tokenChecks(address tokenAddress) {
        (, bool supportedToken, , , ) = tokenManager.tokensInfo(tokenAddress);
        require(supportedToken, "Token not supported");
        _;
    }

    function initialize(
        address _executorManagerAddress,
        address _pauser,
        address _trustedForwarder,
        address _tokenManager,
        address _liquidityProviders
    ) public initializer {
        require(
            _executorManagerAddress != address(0),
            "ExecutorManager cannot be 0x0"
        );
        require(
            _trustedForwarder != address(0),
            "TrustedForwarder cannot be 0x0"
        );
        require(
            _liquidityProviders != address(0),
            "LiquidityProviders cannot be 0x0"
        );
        __ERC2771Context_init(_trustedForwarder);
        __ReentrancyGuard_init();
        __Ownable_init();
        __Pausable_init(_pauser);
        executorManager = IExecutorManager(_executorManagerAddress);
        tokenManager = ITokenManager(_tokenManager);
        liquidityProviders = ILiquidityProviders(_liquidityProviders);
        baseGas = 21000;
    }

    function setTrustedForwarder(address trustedForwarder) external onlyOwner {
        require(trustedForwarder != address(0), "TrustedForwarder can't be 0");
        _trustedForwarder = trustedForwarder;
        emit TrustedForwarderChanged(trustedForwarder);
    }

    function setLiquidityProviders(address _liquidityProviders)
        external
        onlyOwner
    {
        require(
            _liquidityProviders != address(0),
            "LiquidityProviders can't be 0"
        );
        liquidityProviders = ILiquidityProviders(_liquidityProviders);
        emit LiquidityProvidersChanged(_liquidityProviders);
    }

    function setTokenManager(address _tokenManager) external onlyOwner {
        require(_tokenManager != address(0), "TokenManager can't be 0");
        tokenManager = ITokenManager(_tokenManager);
        emit TokenManagerChanged(_tokenManager);
    }

    function setBaseGas(uint128 gas) external onlyOwner {
        baseGas = gas;
    }

    function getExecutorManager() external view returns (address) {
        return address(executorManager);
    }

    function setExecutorManager(address _executorManagerAddress)
        external
        onlyOwner
    {
        require(
            _executorManagerAddress != address(0),
            "Executor Manager cannot be 0"
        );
        executorManager = IExecutorManager(_executorManagerAddress);
    }

    function getCurrentLiquidity(address tokenAddress)
        public
        view
        returns (uint256 currentLiquidity)
    {
        uint256 liquidityPoolBalance = liquidityProviders.getCurrentLiquidity(
            tokenAddress
        );

        currentLiquidity =
            liquidityPoolBalance -
            liquidityProviders.totalLPFees(tokenAddress) -
            gasFeeAccumulatedByToken[tokenAddress] -
            incentivePool[tokenAddress];
    }

    function multiTokenDeposit(
        uint256 toChainId,
        address[] memory tokenAddresses,
        address receiver,
        uint256[] memory amounts,
        string calldata tag,
        string[] memory targetTokens,
        uint256[] memory targetTokenPercentageAllocation
    ) public payable whenNotPaused nonReentrant {
        uint256 length = tokenAddresses.length;
        require(
            length == amounts.length,
            "Token address and amount length mismatch"
        );
        require(
            targetTokens.length == targetTokenPercentageAllocation.length,
            "Target token and allocation length mismatch"
        );
        uint256[] memory finalAmounts = new uint256[](length);
        uint256[] memory rewardAmounts = new uint256[](length);

        for (uint256 i = 0; i < length; ) {
            address tokenAddress = tokenAddresses[i];
            uint256 amount = amounts[i];
            if (tokenAddress == NATIVE) {
                rewardAmounts[i] = _depositNative(receiver, toChainId);
            } else {
                rewardAmounts[i] = _depositErc20(
                    toChainId,
                    tokenAddress,
                    receiver,
                    amount
                );
            }
            finalAmounts[i] = rewardAmounts[i] + amounts[i];
            unchecked {
                ++i;
            }
        }

        emit MultiDeposit(
            _msgSender(),
            tokenAddresses,
            receiver,
            toChainId,
            finalAmounts,
            rewardAmounts,
            tag,
            targetTokens,
            targetTokenPercentageAllocation
        );
    }

    function _depositErc20(
        uint256 toChainId,
        address tokenAddress,
        address receiver,
        uint256 amount
    ) private returns (uint256) {
        TokenConfig memory config = tokenManager.getDepositConfig(
            toChainId,
            tokenAddress
        );

        require(
            config.min <= amount && config.max >= amount,
            "Deposit amount not in Cap limit"
        );
        require(receiver != address(0), "Receiver address cannot be 0");
        require(amount != 0, "Amount cannot be 0");
        address sender = _msgSender();

        uint256 rewardAmount = getRewardAmount(amount, tokenAddress);
        if (rewardAmount != 0) {
            incentivePool[tokenAddress] =
                incentivePool[tokenAddress] -
                rewardAmount;
        }
        liquidityProviders.increaseCurrentLiquidity(tokenAddress, amount);
        SafeERC20Upgradeable.safeTransferFrom(
            IERC20Upgradeable(tokenAddress),
            sender,
            address(this),
            amount
        );
        return rewardAmount;
    }

    /**
     * @dev Function used to deposit tokens into pool to initiate a cross chain token transfer.
     * @param toChainId Chain id where funds needs to be transfered
     * @param tokenAddress ERC20 Token address that needs to be transfered
     * @param receiver Address on toChainId where tokens needs to be transfered
     * @param amount Amount of token being transfered
     */
    function depositErc20(
        uint256 toChainId,
        address tokenAddress,
        address receiver,
        uint256 amount,
        string calldata tag
    ) public tokenChecks(tokenAddress) whenNotPaused nonReentrant {
        uint256 rewardAmount = _depositErc20(
            toChainId,
            tokenAddress,
            receiver,
            amount
        );
        // Emit (amount + reward amount) in event
        emit Deposit(
            _msgSender(), //
            tokenAddress, //
            receiver, //
            toChainId, //
            amount + rewardAmount,
            rewardAmount,
            tag
        );
    }

    function getRewardAmount(uint256 amount, address tokenAddress)
        public
        view
        returns (uint256 rewardAmount)
    {
        uint256 currentLiquidity = getCurrentLiquidity(tokenAddress);
        uint256 providedLiquidity = liquidityProviders
            .getSuppliedLiquidityByToken(tokenAddress);
        if (currentLiquidity < providedLiquidity) {
            uint256 liquidityDifference = providedLiquidity - currentLiquidity;
            if (amount >= liquidityDifference) {
                rewardAmount = incentivePool[tokenAddress];
            } else {
                // Multiply by 10000000000 to avoid 0 reward amount for small amount and liquidity difference
                rewardAmount =
                    (amount * incentivePool[tokenAddress] * 10000000000) /
                    liquidityDifference;
                rewardAmount = rewardAmount / 10000000000;
            }
        }
    }

    /**
     * DAI permit and Deposit.
     */
    function permitAndDepositErc20(
        address tokenAddress,
        address receiver,
        uint256 amount,
        uint256 toChainId,
        PermitRequest calldata permitOptions,
        string calldata tag
    ) external {
        IERC20Permit(tokenAddress).permit(
            _msgSender(),
            address(this),
            permitOptions.nonce,
            permitOptions.expiry,
            permitOptions.allowed,
            permitOptions.v,
            permitOptions.r,
            permitOptions.s
        );
        depositErc20(toChainId, tokenAddress, receiver, amount, tag);
    }

    /**
     * EIP2612 and Deposit.
     */
    function permitEIP2612AndDepositErc20(
        address tokenAddress,
        address receiver,
        uint256 amount,
        uint256 toChainId,
        PermitRequest calldata permitOptions,
        string calldata tag
    ) external {
        IERC20Permit(tokenAddress).permit(
            _msgSender(),
            address(this),
            amount,
            permitOptions.expiry,
            permitOptions.v,
            permitOptions.r,
            permitOptions.s
        );
        depositErc20(toChainId, tokenAddress, receiver, amount, tag);
    }

    /**
     * @dev Function used to deposit native token into pool to initiate a cross chain token transfer.
     * @param receiver Address on toChainId where tokens needs to be transfered
     * @param toChainId Chain id where funds needs to be transfered
     */
    function _depositNative(address receiver, uint256 toChainId)
        private
        returns (uint256)
    {
        require(
            tokenManager.getDepositConfig(toChainId, NATIVE).min <= msg.value &&
                tokenManager.getDepositConfig(toChainId, NATIVE).max >=
                msg.value,
            "Deposit amount not in Cap limit"
        );
        require(receiver != address(0), "Receiver address cannot be 0");
        require(msg.value != 0, "Amount cannot be 0");

        uint256 rewardAmount = getRewardAmount(msg.value, NATIVE);
        if (rewardAmount != 0) {
            incentivePool[NATIVE] = incentivePool[NATIVE] - rewardAmount;
        }
        liquidityProviders.increaseCurrentLiquidity(NATIVE, msg.value);
        return rewardAmount;
    }

    /**
     * @dev Function used to deposit native token into pool to initiate a cross chain token transfer.
     * @param receiver Address on toChainId where tokens needs to be transfered
     * @param toChainId Chain id where funds needs to be transfered
     */
    function depositNative(
        address receiver,
        uint256 toChainId,
        string calldata tag
    ) external payable whenNotPaused nonReentrant {
        uint256 rewardAmount = _depositNative(receiver, toChainId);
        emit Deposit(
            _msgSender(),
            NATIVE,
            receiver,
            toChainId,
            msg.value + rewardAmount,
            rewardAmount,
            tag
        );
    }

    function multiTokenSend(
        address[] calldata tokenAddresses,
        uint256[] calldata amounts,
        address payable receiver,
        bytes calldata depositHash,
        uint256[] calldata tokenGasPrices,
        uint256 fromChainId
    ) external nonReentrant onlyExecutor whenNotPaused {
        require(
            tokenAddresses.length == amounts.length,
            "Length of tokenAddresses and amounts should be same"
        );
        require(
            tokenAddresses.length == tokenGasPrices.length,
            "Length of tokenAddresses and tokenGasPrices should be same"
        );

        uint256 length = tokenAddresses.length;
        for (uint256 i = 0; i < length; ) {
            sendFundsToUser(
                tokenAddresses[i],
                amounts[i],
                receiver,
                depositHash,
                tokenGasPrices[i],
                fromChainId
            );
            unchecked {
                ++i;
            }
        }
    }

    function sendFundsToUser(
        address tokenAddress,
        uint256 amount,
        address payable receiver,
        bytes calldata depositHash,
        uint256 tokenGasPrice,
        uint256 fromChainId
    ) public onlyExecutor whenNotPaused {
        uint256 initialGas = gasleft();
        TokenConfig memory config = tokenManager.getTransferConfig(
            tokenAddress
        );
        require(
            config.min <= amount && config.max >= amount,
            "Withdraw amount not in Cap limit"
        );
        require(receiver != address(0), "Bad receiver address");

        (bytes32 hashSendTransaction, bool status) = checkHashStatus(
            tokenAddress,
            amount,
            receiver,
            depositHash
        );

        require(!status, "Already Processed");
        processedHash[hashSendTransaction] = true;

        // uint256 amountToTransfer, uint256 lpFee, uint256 transferFeeAmount, uint256 gasFee
        uint256[4] memory transferDetails = getAmountToTransfer(
            initialGas,
            tokenAddress,
            amount,
            tokenGasPrice
        );

        liquidityProviders.decreaseCurrentLiquidity(
            tokenAddress,
            transferDetails[0]
        );

        if (tokenAddress == NATIVE) {
            (bool success, ) = receiver.call{value: transferDetails[0]}("");
            require(success, "Native Transfer Failed");
        } else {
            SafeERC20Upgradeable.safeTransfer(
                IERC20Upgradeable(tokenAddress),
                receiver,
                transferDetails[0]
            );
        }

        emit AssetSent(
            tokenAddress,
            amount,
            transferDetails[0],
            receiver,
            depositHash,
            fromChainId,
            transferDetails[1],
            transferDetails[2],
            transferDetails[3]
        );
    }

    /**
     * @dev Internal function to calculate amount of token that needs to be transfered afetr deducting all required fees.
     * Fee to be deducted includes gas fee, lp fee and incentive pool amount if needed.
     * @param initialGas Gas provided initially before any calculations began
     * @param tokenAddress Token address for which calculation needs to be done
     * @param amount Amount of token to be transfered before deducting the fee
     * @param tokenGasPrice Gas price in the token being transfered to be used to calculate gas fee
     * @return [ amountToTransfer, lpFee, transferFeeAmount, gasFee ]
     */
    function getAmountToTransfer(
        uint256 initialGas,
        address tokenAddress,
        uint256 amount,
        uint256 tokenGasPrice
    ) internal returns (uint256[4] memory) {
        TokenInfo memory tokenInfo = tokenManager.getTokensInfo(tokenAddress);
        uint256 transferFeePerc = _getTransferFee(
            tokenAddress,
            amount,
            tokenInfo
        );
        uint256 lpFee;
        if (transferFeePerc > tokenInfo.equilibriumFee) {
            // Here add some fee to incentive pool also
            lpFee = (amount * tokenInfo.equilibriumFee) / BASE_DIVISOR;
            unchecked {
                incentivePool[tokenAddress] +=
                    (amount * (transferFeePerc - tokenInfo.equilibriumFee)) /
                    BASE_DIVISOR;
            }
        } else {
            lpFee = (amount * transferFeePerc) / BASE_DIVISOR;
        }
        uint256 transferFeeAmount = (amount * transferFeePerc) / BASE_DIVISOR;

        liquidityProviders.addLPFee(tokenAddress, lpFee);

        uint256 totalGasUsed = initialGas +
            tokenInfo.transferOverhead +
            baseGas -
            gasleft();

        uint256 gasFee = totalGasUsed * tokenGasPrice;
        gasFeeAccumulatedByToken[tokenAddress] += gasFee;
        gasFeeAccumulated[tokenAddress][_msgSender()] += gasFee;
        uint256 amountToTransfer = amount - (transferFeeAmount + gasFee);
        return [amountToTransfer, lpFee, transferFeeAmount, gasFee];
    }

    function _getTransferFee(
        address tokenAddress,
        uint256 amount,
        TokenInfo memory tokenInfo
    ) private view returns (uint256 fee) {
        uint256 currentLiquidity = getCurrentLiquidity(tokenAddress);
        uint256 providedLiquidity = liquidityProviders
            .getSuppliedLiquidityByToken(tokenAddress);

        uint256 resultingLiquidity = currentLiquidity - amount;

        // Fee is represented in basis points * 10 for better accuracy
        uint256 numerator = providedLiquidity *
            tokenInfo.equilibriumFee *
            tokenInfo.maxFee; // F(max) * F(e) * L(e)
        uint256 denominator = tokenInfo.equilibriumFee *
            providedLiquidity +
            (tokenInfo.maxFee - tokenInfo.equilibriumFee) *
            resultingLiquidity; // F(e) * L(e) + (F(max) - F(e)) * L(r)

        if (denominator == 0) {
            fee = 0;
        } else {
            fee = numerator / denominator;
        }
    }

    function getTransferFee(address tokenAddress, uint256 amount)
        external
        view
        returns (uint256)
    {
        return
            _getTransferFee(
                tokenAddress,
                amount,
                tokenManager.getTokensInfo(tokenAddress)
            );
    }

    function checkHashStatus(
        address tokenAddress,
        uint256 amount,
        address payable receiver,
        bytes calldata depositHash
    ) public view returns (bytes32 hashSendTransaction, bool status) {
        hashSendTransaction = keccak256(
            abi.encode(tokenAddress, amount, receiver, keccak256(depositHash))
        );

        status = processedHash[hashSendTransaction];
    }

    function withdrawErc20GasFee(address tokenAddress)
        external
        onlyExecutor
        whenNotPaused
        nonReentrant
    {
        require(tokenAddress != NATIVE, "Can't withdraw native token fee");
        // uint256 gasFeeAccumulated = gasFeeAccumulatedByToken[tokenAddress];
        uint256 _gasFeeAccumulated = gasFeeAccumulated[tokenAddress][
            _msgSender()
        ];
        require(_gasFeeAccumulated != 0, "Gas Fee earned is 0");
        gasFeeAccumulatedByToken[tokenAddress] =
            gasFeeAccumulatedByToken[tokenAddress] -
            _gasFeeAccumulated;
        gasFeeAccumulated[tokenAddress][_msgSender()] = 0;
        SafeERC20Upgradeable.safeTransfer(
            IERC20Upgradeable(tokenAddress),
            _msgSender(),
            _gasFeeAccumulated
        );
        emit GasFeeWithdraw(tokenAddress, _msgSender(), _gasFeeAccumulated);
    }

    function withdrawNativeGasFee()
        external
        onlyExecutor
        whenNotPaused
        nonReentrant
    {
        uint256 _gasFeeAccumulated = gasFeeAccumulated[NATIVE][_msgSender()];
        require(_gasFeeAccumulated != 0, "Gas Fee earned is 0");
        gasFeeAccumulatedByToken[NATIVE] =
            gasFeeAccumulatedByToken[NATIVE] -
            _gasFeeAccumulated;
        gasFeeAccumulated[NATIVE][_msgSender()] = 0;
        (bool success, ) = payable(_msgSender()).call{
            value: _gasFeeAccumulated
        }("");
        require(success, "Native Transfer Failed");

        emit GasFeeWithdraw(address(this), _msgSender(), _gasFeeAccumulated);
    }

    function transfer(
        address _tokenAddress,
        address receiver,
        uint256 _tokenAmount
    ) external whenNotPaused onlyLiquidityProviders nonReentrant {
        require(receiver != address(0), "Invalid receiver");
        if (_tokenAddress == NATIVE) {
            require(
                address(this).balance >= _tokenAmount,
                "ERR__INSUFFICIENT_BALANCE"
            );
            (bool success, ) = receiver.call{value: _tokenAmount}("");
            require(success, "ERR__NATIVE_TRANSFER_FAILED");
        } else {
            IERC20Upgradeable baseToken = IERC20Upgradeable(_tokenAddress);
            require(
                baseToken.balanceOf(address(this)) >= _tokenAmount,
                "ERR__INSUFFICIENT_BALANCE"
            );
            SafeERC20Upgradeable.safeTransfer(
                baseToken,
                receiver,
                _tokenAmount
            );
        }
    }

    function _msgSender()
        internal
        view
        virtual
        override(ContextUpgradeable, ERC2771ContextUpgradeable)
        returns (address sender)
    {
        return ERC2771ContextUpgradeable._msgSender();
    }

    function _msgData()
        internal
        view
        virtual
        override(ContextUpgradeable, ERC2771ContextUpgradeable)
        returns (bytes calldata)
    {
        return ERC2771ContextUpgradeable._msgData();
    }

    receive() external payable {
        emit EthReceived(_msgSender(), msg.value);
    }
}
