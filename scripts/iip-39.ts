import { task } from "hardhat/config"
import { BigNumber } from "ethers";

const DISTRIBUTOR_ABI = require("../abi/Distributor.json");
const addresses = require("../common/addresses")
const GOVERNABLE_FUND = require("../abi/GovernableFund.json");
const ERC20_ABI = require("../abi/ERC20.json");
const IdleTokenABI = require("../abi/IdleTokenGovernance.json")
const IDLE_CONTROLLER_ABI = require("../abi/IdleController.json");
const ILendingProtocolABI = require("../abi/ILendingProtocol.json");
const FeeCollectorABI = require("../abi/FeeCollector.json")
let _hre;
const toBN = function (v: any): BigNumber { return BigNumber.from(v.toString()) };
const ONE = toBN(1e18);
const ONE6 = toBN(1e6);
const check = (condition: boolean, message: string) => {
  if (condition) {
    console.log(`✅ Correct ${message}`);
  } else {
    console.log(`🚨 Incorrect ${message}`);
  }
};
const checkAlmostEqual = (a: any, b: any, tolerance: any, message: any) => {
  const diff = a.sub(b).abs();
  const maxDiff = a.mul(tolerance).div(toBN(100));
  if (diff.lte(maxDiff)) {
    console.log(`✅ Correct ${message}`);
  } else {
    console.log(`🚨 Incorrect ${message}`);
  }
}

const iipDescription = "IIP-39: Add AA_mmSteakUSDC to IdleUSDC. Stop IDLE emissions. Transfer funds for ROX deal and Leagues budget";

export default task("iip-39", iipDescription).setAction(async (_, hre) => {
  _hre = hre;
  const isLocalNet = hre.network.name == 'hardhat';

  const idle = await hre.ethers.getContractAt(ERC20_ABI, addresses.IDLE);
  const usdc = await hre.ethers.getContractAt(ERC20_ABI, '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48');
  // const usdc = await hre.ethers.getContractAt(ERC20_ABI, addresses.USDC.live);
  const distributor = await hre.ethers.getContractAt(DISTRIBUTOR_ABI, addresses.gaugeDistributor);
  const idleController = await hre.ethers.getContractAt(IDLE_CONTROLLER_ABI, addresses.idleController);
  const ecosystemFund = await hre.ethers.getContractAt(GOVERNABLE_FUND, addresses.ecosystemFund)
  const longTermFund = await hre.ethers.getContractAt(GOVERNABLE_FUND, addresses.longTermFund)
  const feeCollector = await hre.ethers.getContractAt(FeeCollectorABI, addresses.feeCollector);
  const feeTreasury = await hre.ethers.getContractAt(GOVERNABLE_FUND, addresses.feeTreasury);

  // ############# PARAMS for AA_steakUSDC in idleUSDC #############
  const idleToken = await hre.ethers.getContractAt(IdleTokenABI, addresses.idleUSDCV4);
  const idleTokenName = await idleToken.name();
  console.log(`📄 adding proposal action for ${idleTokenName}`);

  const allGovTokens = await idleToken.getGovTokens();
  console.log('All gov tokens (USDC)', allGovTokens);

  // New wrappers and protocol token for aa tranches
  const wrapper = '0x96Dd27112bDd615c3A2D649fe22d8eE27e448152';
  const protocolToken = addresses.AA_steakUSDC.live.toLowerCase();
  const paramUSDC = await getParamsForSetAll(idleToken, wrapper, protocolToken, addresses.addr0, hre);
  // ############# END PARAMS for metamorpho ##########
  
  // ############# PARAMS for ROX deal and Leagues #############
  const idleReceiver = addresses.treasuryMultisig;
  const idleFrom = addresses.ecosystemFund;
  const idleFromEcosystemFund = toBN("66490").mul(ONE);
  console.log(`📄 IDLE receiver ${idleReceiver}, amount: ${idleFromEcosystemFund.div(ONE)}`);
  
  const usdcReceiver = addresses.treasuryMultisig;
  const usdcFrom = addresses.feeTreasury;
  const usdcFromFeeTreasury = toBN("125000").mul(ONE6);
  console.log(`📄 USDC receiver ${usdcReceiver}, amount: ${usdcFromFeeTreasury.div(ONE6)}`);
  
  // Get balances for tests
  const ecosystemFundIDLEBalanceBefore = await idle.balanceOf(idleFrom);
  const feeTreasuryUSDCBalanceBefore = await usdc.balanceOf(usdcFrom);
  const idleReceiverBalanceBefore = await idle.balanceOf(idleReceiver);
  const tlmultisigUSDCBalanceBefore = await usdc.balanceOf(usdcReceiver);
  // ############# END PARAMS for BUDGET ##########
  
  // ############# PARAMS for stopping IDLE emissions ##########
  const newControllerRate = toBN(0);
  // ############# END PARAMS for topping emissions ############
  
  let proposalBuilder = hre.proposals.builders.alpha();
  proposalBuilder = proposalBuilder
    .addContractAction(idleController, "_setIdleRate", [newControllerRate])
    .addContractAction(idleToken, "setAllAvailableTokensAndWrappers", [
      paramUSDC.protocolTokens,
      paramUSDC.wrappers,
      paramUSDC.govTokens,
      paramUSDC.govTokensEqualLength
    ])
    .addContractAction(idleController, "claimIdle", [
      [addresses.treasuryMultisig], 
      [addresses.idleUSDCV4, addresses.idleDAIV4, addresses.idleUSDTV4, addresses.idleWETHV4]
    ])
    .addContractAction(ecosystemFund, "transfer", [addresses.IDLE, idleReceiver, idleFromEcosystemFund])
    .addContractAction(feeTreasury, "transfer", [addresses.USDC.live, usdcReceiver, usdcFromFeeTreasury])
    
    // Print and execute proposal
    proposalBuilder.setDescription(iipDescription);
    const proposal = proposalBuilder.build()
    await proposal.printProposalInfo();
    await hre.run('execute-proposal-or-simulate', { proposal, isLocalNet });

  // Skip tests in mainnet
  if (!isLocalNet) {
    return;
  }
  console.log("Checking effects...");

  // Check that new protocols are added
  console.log('Checking idleUSDC...');
  await checkEffects(idleToken, allGovTokens, wrapper, protocolToken, addresses.addr0, paramUSDC.oldProtocolTokens, hre);
  
  // check that controller rate is set to 0
  console.log('Checking IdleController...');
  const controllerRate = await idleController.idleRate();
  check(controllerRate.eq(newControllerRate), `Controller rate set to 0`);

  // check idleSpeeds
  [addresses.idleUSDCV4, addresses.idleDAIV4, addresses.idleUSDTV4, addresses.idleWETHV4].forEach(async (idleTokenAddress) => {
    const idleSpeed = await idleController.idleSpeeds(idleTokenAddress);
    check(idleSpeed.eq(toBN(0)), `Idle speed set to 0 for ${idleTokenAddress}`);
  });
  
  // check that IDLE funds are sent to longTermFund
  console.log('Checking IDLE funds...');
  const ecosystemFundIDLEBalanceAfter = await idle.balanceOf(addresses.ecosystemFund);
  const roxIDLEBalanceAfter = await idle.balanceOf(idleReceiver);
  checkAlmostEqual(ecosystemFundIDLEBalanceAfter, ecosystemFundIDLEBalanceBefore.sub(idleFromEcosystemFund), toBN(0), `IDLE transferred from ecosystemFund`);
  checkAlmostEqual(roxIDLEBalanceAfter, idleReceiverBalanceBefore.add(idleFromEcosystemFund), toBN(0), `IDLE transferred to roxReceiver`);

  // check that USDC funds are sent to longTermFund
  console.log('Checking USDC funds...');
  const feeTreasuryUSDCBalanceAfter = await usdc.balanceOf(usdcFrom);
  const tlmultisigUSDCBalanceAfter = await usdc.balanceOf(usdcReceiver);
  checkAlmostEqual(feeTreasuryUSDCBalanceAfter, feeTreasuryUSDCBalanceBefore.sub(usdcFromFeeTreasury), toBN(100), `USDC transferred from feeTreasury`);
  checkAlmostEqual(tlmultisigUSDCBalanceAfter, tlmultisigUSDCBalanceBefore.add(usdcFromFeeTreasury), toBN(0), `USDC transferred to tlmultisig`);
});

const getParamsForSetAll = async (
  idleToken: any, 
  newWrapper: any, 
  newProtocolToken: any,
  oldProtocolToken: any, 
  hre: any
) => {
  let protocolTokens = [...(await idleToken.getAPRs())["0"]].map(x => x.toLowerCase())
  let wrappers = []
  let govTokensEqualLength = []
  let govTokens = [];
  let newProtocolTokens = [];

  console.log('protocolTokens', protocolTokens);
  const isRemoving = newProtocolToken == addresses.addr0.toLowerCase();
  const isReplacing = oldProtocolToken != addresses.addr0.toLowerCase();
  const newLenDiff = isRemoving ? 1 : 0;

  for (var i = 0; i < protocolTokens.length - newLenDiff; i++) {
    const token = await hre.ethers.getContractAt(ERC20_ABI, protocolTokens[i]);
    const wrapper = await idleToken.protocolWrappers(token.address);
    console.log(await token.name(), token.address, " => ", wrapper);

    const govToken = await idleToken.getProtocolTokenToGov(token.address)
    if (govToken.toLowerCase() != addresses.addr0.toLowerCase()) {
      govTokens.push(govToken);
    }
    if (isReplacing && token.address.toLowerCase() == oldProtocolToken) {
      wrappers.push(newWrapper);
      govTokensEqualLength.push(addresses.addr0.toLowerCase());
      newProtocolTokens.push(newProtocolToken);
      continue;
    }
    wrappers.push(wrapper);
    govTokensEqualLength.push(govToken);
    newProtocolTokens.push(protocolTokens[i]);
  };

  if (!isRemoving && !isReplacing) {
    // update protocol tokens with new protocol token
    newProtocolTokens = [...newProtocolTokens, newProtocolToken];
    // update last wrapper (aa senior tranche)
    wrappers = [...wrappers, newWrapper];
    // update govTokensEqualLength with new gov token set as addr0
    govTokensEqualLength = [...govTokensEqualLength, addresses.addr0.toLowerCase()];
  }
  // add IDLE distribution
  govTokens.push(addresses.IDLE);

  return {
    oldProtocolTokens: protocolTokens,
    protocolTokens: newProtocolTokens,
    wrappers,
    govTokensEqualLength,
    govTokens
  }
};

const checkEffects = async (
  idleToken: any,
  allGovTokens: any,
  newWrapper: any,
  newProtocolToken: any,
  oldProtocolToken: any,
  oldProtocolTokens: any,
  hre: any
) => {
  const isRemoving = newProtocolToken == addresses.addr0.toLowerCase();
  const isReplacing = oldProtocolToken != addresses.addr0.toLowerCase();
  const newGovTokens = await idleToken.getGovTokens();
  console.log('newGovTokens', newGovTokens);
  check(newGovTokens.length == allGovTokens.length, `Gov tokens length did not change`);

  let newProtocolTokens = [...(await idleToken.getAPRs())["0"]].map(x => x.toLowerCase());
  if (isRemoving) {
    check(newProtocolTokens.length == oldProtocolTokens.length - 1, `Protocol tokens length decreased by 1`);
  } else if (isReplacing) {
    check(newProtocolTokens.length == oldProtocolTokens.length, `Protocol tokens length did not change: ${newProtocolTokens.length}`);
  } else {
    check(newProtocolTokens[newProtocolTokens.length - 1].toLowerCase() == newProtocolToken,
    `New token added is the correct one`);
  }
  
  const newWrappers = [];
  const oldTokenIdx = oldProtocolToken ? oldProtocolTokens.indexOf(oldProtocolToken) : null;

  for (var i = 0; i < newProtocolTokens.length; i++) {
    const token = await hre.ethers.getContractAt(ERC20_ABI, newProtocolTokens[i]);
    const wrapper = await idleToken.protocolWrappers(token.address);
    console.log(await token.name(), token.address, " => ", wrapper);
    if (isReplacing && oldTokenIdx != null && i == oldTokenIdx) {
      check(wrapper.toLowerCase() == newWrapper.toLowerCase(), `Old wrapper replaced`);
      check(token.address.toLowerCase() == newProtocolToken.toLowerCase(), `Old token replaced`);
    }

    if (isReplacing && oldTokenIdx == null) {
      console.log('ERROR: oldTokenIdx is null');
    }

    const govToken = await idleToken.getProtocolTokenToGov(token.address)
    console.log('-- govToken: ', govToken);
    newWrappers.push(wrapper);
  };

  if (!isRemoving && !isReplacing) {
    check(newWrappers[newWrappers.length - 1].toLowerCase() == newWrapper.toLowerCase(), `New wrapper added`);
  }

  // Test rebalances idleToken all in new protocol
  // All funds in the new protocol
  let allocations = newProtocolTokens.map(
    (_, i) => {
      // if is adding, all funds in the new protocol (ie last one)
      if (!isRemoving && !isReplacing && i == newProtocolTokens.length - 1) {
        return 100000;
      } else if (isReplacing && i == oldTokenIdx) {
        return 100000;
      } else {
        return 0;
      }
    }
  );
  await hre.run("test-idle-token", { idleToken, allocations })

  // All funds in the first protocol
  // allocations = newProtocolTokens.map((_, i) => i == 0 ? 100000 : 0);
  allocations = newProtocolTokens.map(
    (_, i) => {
      // if is replacing a protocol (not with idx 0) or is not replacing => all on first protocol
      if (((oldTokenIdx != null && oldTokenIdx != 0) || (oldTokenIdx == null)) && i == 0) {
        return 100000;
      } else if (oldTokenIdx != null && oldTokenIdx == 0 && i == 1) {
        // if is replacing a protocol with idx 0 => all on second protocol
        return 100000;
      } else {
        return 0;
      }
    }
  );
  await hre.run("test-idle-token", { idleToken, allocations })
}
