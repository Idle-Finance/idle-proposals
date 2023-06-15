import { task } from "hardhat/config"
import { BigNumber } from "ethers";

const DISTRIBUTOR_ABI = require("../abi/Distributor.json");
const addresses = require("../common/addresses")
const GOVERNABLE_FUND = require("../abi/GovernableFund.json");
const ERC20_ABI = require("../abi/ERC20.json");
const IdleTokenABI = require("../abi/IdleTokenGovernance.json")
const IDLE_CONTROLLER_ABI = require("../abi/IdleController.json");
const FeeCollectorABI = require("../abi/FeeCollector.json")
let _hre;
const toBN = function (v: any): BigNumber { return BigNumber.from(v.toString()) };
const ONE = toBN(1e18);
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

const iipDescription = "IIP-36: Add AA_cpFAS-USDC to IdleUSDC. Remove Euler from idleWETH. Stop fee sharing for stkIDLE";

export default task("iip-36", iipDescription).setAction(async (_, hre) => {
  _hre = hre;
  const isLocalNet = hre.network.name == 'hardhat';

  const idle = await hre.ethers.getContractAt(ERC20_ABI, addresses.IDLE);
  const distributor = await hre.ethers.getContractAt(DISTRIBUTOR_ABI, addresses.gaugeDistributor);
  const idleController = await hre.ethers.getContractAt(IDLE_CONTROLLER_ABI, addresses.idleController);
  const ecosystemFund = await hre.ethers.getContractAt(GOVERNABLE_FUND, addresses.ecosystemFund)
  const feeCollector = await hre.ethers.getContractAt(FeeCollectorABI, addresses.feeCollector);
  const feeTreasury = await hre.ethers.getContractAt(GOVERNABLE_FUND, addresses.feeTreasury);

  // ############# PARAMS for clearpool in idleUSDC and idleWETH #############
  const idleToken = await hre.ethers.getContractAt(IdleTokenABI, addresses.idleUSDCV4);
  const idleTokenName = await idleToken.name();
  console.log(`📄 adding proposal action for ${idleTokenName}`);
  const idleTokenWETH = await hre.ethers.getContractAt(IdleTokenABI, addresses.idleWETHV4);
  const idleTokenNameWETH = await idleTokenWETH.name();
  console.log(`📄 adding proposal action for ${idleTokenNameWETH}`);

  const idleTokenDAI = await hre.ethers.getContractAt(IdleTokenABI, addresses.idleDAIV4);
  const idleTokenUSDT = await hre.ethers.getContractAt(IdleTokenABI, addresses.idleUSDTV4);
  
  const allGovTokens = await idleToken.getGovTokens();
  console.log('All gov tokens (USDC)', allGovTokens);
  const allGovTokensWETH = await idleToken.getGovTokens();
  console.log('All gov tokens (WETH)', allGovTokensWETH);
  
  // New wrappers and protocol token for aa tranches
  const wrapper = '0x3E9A5c91eC8b5022E88d1C2599fE3CD98406D898';
  const protocolToken = addresses.AA_cpFAS_USDC.live.toLowerCase();
  
  const paramUSDC = await getParamsForSetAll(idleToken, wrapper, protocolToken, hre);
  const paramWETH = await getParamsForSetAll(idleTokenWETH, addresses.addr0, addresses.addr0, hre);
  // ############# END PARAMS for clearpool ##########

  // ############# PARAMS for BUDGET #############
  // we need to:
  // - set fee receiver of idleTokens to feeTreasury
  // - get funds from feeCollector and send them to feeTreasury
  const newFeeReceiver = addresses.feeTreasury;
  console.log(`📄 New fee receive ${newFeeReceiver}`);

  const usdt = await hre.ethers.getContractAt(ERC20_ABI, addresses.USDT.live); // USDT 
  const usdc = await hre.ethers.getContractAt(ERC20_ABI, addresses.USDC.live); // USDC 
  const dai = await hre.ethers.getContractAt(ERC20_ABI, addresses.DAI.live); // DAI 
  const usdtFromTreasury = await usdt.balanceOf(addresses.feeCollector);
  const usdcFromTreasury = await usdc.balanceOf(addresses.feeCollector);
  const daiFromTreasury = await dai.balanceOf(addresses.feeCollector);

  // Get balances for tests
  const feeTreasuryUSDTBalanceBefore = await usdt.balanceOf(addresses.feeTreasury);
  const feeTreasuryUSDCBalanceBefore = await usdc.balanceOf(addresses.feeTreasury);
  const feeTreasuryDAIBalanceBefore = await dai.balanceOf(addresses.feeTreasury);
  // ############# END PARAMS for BUDGET ##########

  let proposalBuilder = hre.proposals.builders.alpha();
  proposalBuilder = proposalBuilder
    .addContractAction(idleToken, "setAllAvailableTokensAndWrappers", [
      paramUSDC.protocolTokens,
      paramUSDC.wrappers,
      paramUSDC.govTokens,
      paramUSDC.govTokensEqualLength
    ])
    .addContractAction(idleTokenWETH, "setAllAvailableTokensAndWrappers", [
      paramWETH.protocolTokens,
      paramWETH.wrappers,
      paramWETH.govTokens,
      paramWETH.govTokensEqualLength
    ])
    .addContractAction(idleToken, "setFeeAddress", [newFeeReceiver])
    .addContractAction(idleTokenWETH, "setFeeAddress", [newFeeReceiver])
    .addContractAction(idleTokenDAI, "setFeeAddress", [newFeeReceiver])
    .addContractAction(idleTokenUSDT, "setFeeAddress", [newFeeReceiver])
    .addContractAction(feeCollector, "withdraw", [addresses.USDT.live, newFeeReceiver, usdtFromTreasury])
    .addContractAction(feeCollector, "withdraw", [addresses.USDC.live, newFeeReceiver, usdcFromTreasury])
    .addContractAction(feeCollector, "withdraw", [addresses.DAI.live, newFeeReceiver, daiFromTreasury])

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
  await checkEffects(idleToken, allGovTokens, wrapper, protocolToken, paramUSDC.oldProtocolTokens, hre);
  console.log('Checking idleWETH...');
  await checkEffects(idleTokenWETH, allGovTokensWETH, addresses.addr0, addresses.addr0, paramWETH.oldProtocolTokens, hre);
  
  // check that fee address is updated for all idleTokens
  console.log('Checking fee addresses');
  check((await idleToken.feeAddress()).toLowerCase() == newFeeReceiver.toLowerCase(), `feeReceiver updated for idleToken`);
  check((await idleTokenWETH.feeAddress()).toLowerCase() == newFeeReceiver.toLowerCase(), `feeReceiver updated for idleTokenWETH`);
  check((await idleTokenDAI.feeAddress()).toLowerCase() == newFeeReceiver.toLowerCase(), `feeReceiver updated for idleTokenDAI`);
  check((await idleTokenUSDT.feeAddress()).toLowerCase() == newFeeReceiver.toLowerCase(), `feeReceiver updated for idleTokenUSDT`);
  
  // check that fee collector funds are sent to feeTreasury
  console.log('Checking funds');
  const feeTreasuryUSDTBalanceAfter = await usdt.balanceOf(newFeeReceiver);
  checkAlmostEqual(feeTreasuryUSDTBalanceAfter, feeTreasuryUSDTBalanceBefore.add(usdtFromTreasury), toBN(0), `USDT transferred to feeTreasury`);
  const feeTreasuryUSDCBalanceAfter = await usdc.balanceOf(newFeeReceiver);
  checkAlmostEqual(feeTreasuryUSDCBalanceAfter, feeTreasuryUSDCBalanceBefore.add(usdcFromTreasury), toBN(0), `USDC transferred to feeTreasury`);
  const feeTreasuryDAIBalanceAfter = await dai.balanceOf(newFeeReceiver);
  checkAlmostEqual(feeTreasuryDAIBalanceAfter, feeTreasuryDAIBalanceBefore.add(daiFromTreasury), toBN(0), `DAI transferred to feeTreasury`);
});

const getParamsForSetAll = async (idleToken: any, newWrapper: any, newProtocolToken: any, hre: any) => {
  let protocolTokens = [...(await idleToken.getAPRs())["0"]].map(x => x.toLowerCase())
  let wrappers = []
  let govTokensEqualLength = []
  let govTokens = [];
  let newProtocolTokens = [];

  console.log('protocolTokens', protocolTokens);
  const isRemoving = newProtocolToken == addresses.addr0.toLowerCase();
  const newLenDiff = isRemoving ? 1 : 0;
  for (var i = 0; i < protocolTokens.length - newLenDiff; i++) {
    const token = await hre.ethers.getContractAt(ERC20_ABI, protocolTokens[i]);
    const wrapper = await idleToken.protocolWrappers(token.address);
    console.log(await token.name(), token.address, " => ", wrapper);

    const govToken = await idleToken.getProtocolTokenToGov(token.address)
    if (govToken.toLowerCase() != addresses.addr0.toLowerCase()) {
      govTokens.push(govToken);
    }
    wrappers.push(wrapper);
    govTokensEqualLength.push(govToken);
    newProtocolTokens.push(protocolTokens[i]);
  };

  if (!isRemoving) {
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

const checkEffects = async (idleToken: any, allGovTokens: any, newWrapper: any, newProtocolToken: any, oldProtocolTokens: any, hre: any) => {
  const isRemoving = newProtocolToken == addresses.addr0.toLowerCase();
  const newGovTokens = await idleToken.getGovTokens();
  console.log('newGovTokens', newGovTokens);
  check(newGovTokens.length == allGovTokens.length, `Gov tokens length did not change`);

  let newProtocolTokens = [...(await idleToken.getAPRs())["0"]].map(x => x.toLowerCase());
  if (isRemoving) {
    check(newProtocolTokens.length == oldProtocolTokens.length - 1, `Protocol tokens length decreased by 1`);
  } else {
    check(newProtocolTokens[newProtocolTokens.length - 1].toLowerCase() == newProtocolToken,
      `New token added is the correct one`);
  }

  const newWrappers = [];
  for (var i = 0; i < newProtocolTokens.length; i++) {
    const token = await hre.ethers.getContractAt(ERC20_ABI, newProtocolTokens[i]);
    const wrapper = await idleToken.protocolWrappers(token.address);
    console.log(await token.name(), token.address, " => ", wrapper);

    const govToken = await idleToken.getProtocolTokenToGov(token.address)
    console.log('-- govToken: ', govToken);
    newWrappers.push(wrapper);
  };

  if (!isRemoving) {
    check(newWrappers[newWrappers.length - 1].toLowerCase() == newWrapper.toLowerCase(), `New wrapper added`);
  }

  // Test rebalances idleDAI
  // All funds in the new protocol
  let allocations = newProtocolTokens.map((_, i) => i == newProtocolTokens.length - 1 ? 100000 : 0);
  await hre.run("test-idle-token", { idleToken, allocations })

  // All funds in the first protocol
  allocations = newProtocolTokens.map((_, i) => i == 0 ? 100000 : 0);
  await hre.run("test-idle-token", { idleToken, allocations })
}
