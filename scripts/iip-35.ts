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

const iipDescription = "IIP-35: Add Clearpool portofino and fasanara AA tranche wrapper to IdleUSDC and IdleUSDT. Reduce LM to 250 IDLE/day. Get Leagues budget";

export default task("iip-35", iipDescription).setAction(async (_, hre) => {
  _hre = hre;
  const isLocalNet = hre.network.name == 'hardhat';

  const idle = await hre.ethers.getContractAt(ERC20_ABI, addresses.IDLE);
  const distributor = await hre.ethers.getContractAt(DISTRIBUTOR_ABI, addresses.gaugeDistributor);
  const idleController = await hre.ethers.getContractAt(IDLE_CONTROLLER_ABI, addresses.idleController);
  const ecosystemFund = await hre.ethers.getContractAt(GOVERNABLE_FUND, addresses.ecosystemFund)
  const feeCollector = await hre.ethers.getContractAt(FeeCollectorABI, addresses.feeCollector);
  const feeTreasury = await hre.ethers.getContractAt(GOVERNABLE_FUND, addresses.feeTreasury);

  // ############# PARAMS for clearpool #############
  const idleToken = await hre.ethers.getContractAt(IdleTokenABI, addresses.idleUSDCV4);
  const idleTokenName = await idleToken.name();
  console.log(`📄 adding proposal action for ${idleTokenName}`);
  const idleTokenUSDT = await hre.ethers.getContractAt(IdleTokenABI, addresses.idleUSDTV4);
  const idleTokenNameUSDT = await idleTokenUSDT.name();
  console.log(`📄 adding proposal action for ${idleTokenNameUSDT}`);
  
  const allGovTokens = await idleToken.getGovTokens();
  console.log('All gov tokens (USDC)', allGovTokens);
  const allGovTokensUSDT = await idleToken.getGovTokens();
  console.log('All gov tokens (USDT)', allGovTokensUSDT);
  
  // New wrappers for aa tranches
  const wrapper = '0xF1fdd2FbB34969B4cD034331D37A7360B0b75c51';
  // New protocol tokens
  const protocolToken = addresses.AA_cpPOR_USDC.live.toLowerCase();
  // New wrappers for aa tranches
  const wrapperUSDT = '0xAC64A8b5Fae61b31F9eDc6e3d15673039D8122B1';
  // New protocol tokens
  const protocolTokenUSDT = addresses.AA_cpFAS_USDT.live.toLowerCase();
  // New controller rate
  const newControllerRate = toBN("250").mul(ONE).div(toBN("7160"));
  
  const paramUSDC = await getParamsForSetAll(idleToken, wrapper, protocolToken, hre);
  const paramUSDT = await getParamsForSetAll(idleTokenUSDT, wrapperUSDT, protocolTokenUSDT, hre);
  // ############# END PARAMS for clearpool ##########
  
  // ############# PARMAS for BUDGET #############
  const weth = await hre.ethers.getContractAt(ERC20_ABI, addresses.WETH.live); // WETH    
  const stkAAVE = await hre.ethers.getContractAt(ERC20_ABI, addresses.stkAAVE.live); // stkAAVE    
  const usdt = await hre.ethers.getContractAt(ERC20_ABI, addresses.USDT.live); // USDT 
  const usdc = await hre.ethers.getContractAt(ERC20_ABI, addresses.USDC.live); // USDT 
  const rai = await hre.ethers.getContractAt(ERC20_ABI, addresses.RAI.live); // RAI 
  const susd = await hre.ethers.getContractAt(ERC20_ABI, addresses.SUSD.live); // susd

  // IIP should also transfer the following amounts to the Treasury League Multisig
  const stkAAVEFromCollector = await stkAAVE.balanceOf(addresses.feeCollector);
  const raifromCollector = await rai.balanceOf(addresses.feeCollector);
  const susdFromCollector = await susd.balanceOf(addresses.feeCollector);

  const stkAAVEFromTreasury = await stkAAVE.balanceOf(addresses.feeTreasury);
  const wethFromTreasury = await weth.balanceOf(addresses.feeTreasury);
  const usdtFromTreasury = await usdt.balanceOf(addresses.feeTreasury);
  const usdcFromTreasury = await usdc.balanceOf(addresses.feeTreasury);

  // Get balances for tests
  const tlMultisigWethBalanceBefore = await weth.balanceOf(addresses.treasuryMultisig);
  const tlMultisigAAVEBalanceBefore = await stkAAVE.balanceOf(addresses.treasuryMultisig);
  const tlMultisigUSDTBalanceBefore = await usdt.balanceOf(addresses.treasuryMultisig);
  const tlMultisigRAIBalanceBefore = await rai.balanceOf(addresses.treasuryMultisig);
  const tlMultisigSUSDBalanceBefore = await susd.balanceOf(addresses.treasuryMultisig);
  const tlMultisigUSDCBalanceBefore = await usdc.balanceOf(addresses.treasuryMultisig);
  // ############# END PARAMS for BUDGET ##########

  let proposalBuilder = hre.proposals.builders.alpha();
  proposalBuilder = proposalBuilder
    .addContractAction(idleToken, "setAllAvailableTokensAndWrappers", [
      paramUSDC.protocolTokens,
      paramUSDC.wrappers,
      paramUSDC.govTokens,
      paramUSDC.govTokensEqualLength
    ])
    .addContractAction(idleTokenUSDT, "setAllAvailableTokensAndWrappers", [
      paramUSDT.protocolTokens,
      paramUSDT.wrappers,
      paramUSDT.govTokens,
      paramUSDT.govTokensEqualLength
    ])
    .addContractAction(idleController, "_dropIdleMarket", [addresses.idleWBTCV4])
    .addContractAction(idleController, "_setIdleRate", [
      newControllerRate
    ])
    .addContractAction(feeCollector, "withdraw", [addresses.stkAAVE.live, addresses.treasuryMultisig, stkAAVEFromCollector])
    .addContractAction(feeCollector, "withdraw", [addresses.SUSD.live, addresses.treasuryMultisig, susdFromCollector])
    .addContractAction(feeCollector, "withdraw", [addresses.RAI.live, addresses.treasuryMultisig, raifromCollector])

    .addContractAction(feeTreasury, "transfer", [addresses.stkAAVE.live, addresses.treasuryMultisig, stkAAVEFromTreasury])
    .addContractAction(feeTreasury, "transfer", [addresses.WETH.live, addresses.treasuryMultisig, wethFromTreasury])
    .addContractAction(feeTreasury, "transfer", [addresses.USDT.live, addresses.treasuryMultisig, usdtFromTreasury])
    .addContractAction(feeTreasury, "transfer", [addresses.USDC.live, addresses.treasuryMultisig, usdcFromTreasury])


  if (isLocalNet) {
    // call refreshIdleSpeeds of idleController manually to update speeds
    await idleController.refreshIdleSpeeds();
  }
  // get idleDAI, idleUSDC and idleUSDT speeds from controller before proposal
  const idleDAISpeedBefore = await idleController.idleSpeeds(addresses.idleDAIV4);
  const idleUSDCSpeedBefore = await idleController.idleSpeeds(addresses.idleUSDCV4);
  const idleUSDTSpeedBefore = await idleController.idleSpeeds(addresses.idleUSDTV4);

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
  await checkEffects(idleToken, allGovTokens, wrapper, protocolToken, hre);
  console.log('Checking idleUSDT...');
  await checkEffects(idleTokenUSDT, allGovTokensUSDT, wrapperUSDT, protocolTokenUSDT, hre);

  // check wbtc removed from idleController
  check(!(await idleController.markets(addresses.idleWBTCV4)).isIdled, `idleWBTCV4 removed`);

  // Check that idleDAI, idleUSDC and idleUSDT speeds are half than before, with 1% tolerance
  const idleDAISpeedAfter = await idleController.idleSpeeds(addresses.idleDAIV4);
  checkAlmostEqual(idleDAISpeedAfter, idleDAISpeedBefore.div(toBN(2)), toBN(1), `idleDAI speed is half than before`);
  const idleUSDCSpeedAfter = await idleController.idleSpeeds(addresses.idleUSDCV4);
  checkAlmostEqual(idleUSDCSpeedAfter, idleUSDCSpeedBefore.div(toBN(2)), toBN(1), `idleUSDC speed is half than before`);
  const idleUSDTSpeedAfter = await idleController.idleSpeeds(addresses.idleUSDTV4);
  checkAlmostEqual(idleUSDTSpeedAfter, idleUSDTSpeedBefore.div(toBN(2)), toBN(1), `idleUSDT speed is half than before`);

  // Check that transferred balances are correct
  const tlMultisigWethBalanceAfter = await weth.balanceOf(addresses.treasuryMultisig);
  checkAlmostEqual(tlMultisigWethBalanceAfter, tlMultisigWethBalanceBefore.add(wethFromTreasury), toBN(0), `WETH transferred to treasuryMultisig`);
  const tlMultisigUSDTBalanceAfter = await usdt.balanceOf(addresses.treasuryMultisig);
  checkAlmostEqual(tlMultisigUSDTBalanceAfter, tlMultisigUSDTBalanceBefore.add(usdtFromTreasury), toBN(0), `USDT transferred to treasuryMultisig`);
  const tlMultisigSTKAAVEBalanceAfter = await stkAAVE.balanceOf(addresses.treasuryMultisig);
  checkAlmostEqual(tlMultisigSTKAAVEBalanceAfter, tlMultisigAAVEBalanceBefore.add(stkAAVEFromTreasury).add(stkAAVEFromCollector), toBN(0), `stkAAVE transferred to treasuryMultisig`);
  const tlMultisigSUSDBalanceAfter = await susd.balanceOf(addresses.treasuryMultisig);
  checkAlmostEqual(tlMultisigSUSDBalanceAfter, tlMultisigSUSDBalanceBefore.add(susdFromCollector), toBN(0), `SUSD transferred to treasuryMultisig`);
  const tlMultisigRAIBalanceAfter = await rai.balanceOf(addresses.treasuryMultisig);
  checkAlmostEqual(tlMultisigRAIBalanceAfter, tlMultisigRAIBalanceBefore.add(raifromCollector), toBN(0), `RAI transferred to treasuryMultisig`);
  const tlMultisigUSDCBalanceAfter = await usdc.balanceOf(addresses.treasuryMultisig);
  checkAlmostEqual(tlMultisigUSDCBalanceAfter, tlMultisigUSDCBalanceBefore.add(usdcFromTreasury), toBN(0), `USDC transferred to treasuryMultisig`);
});

const getParamsForSetAll = async (idleToken: any, newWrapper: any, newProtocolToken: any, hre: any) => {
  let protocolTokens = [...(await idleToken.getAPRs())["0"]].map(x => x.toLowerCase())
  let wrappers = []
  let govTokensEqualLength = []
  let govTokens = [];
  let newProtocolTokens = [];

  console.log('protocolTokens', protocolTokens);
  // loop until protocolTokens.length - 2 so to remove last protocol
  for (var i = 0; i < protocolTokens.length - 1; i++) {
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

  // update protocol tokens with new protocol token
  newProtocolTokens = [...newProtocolTokens, newProtocolToken];
  // update last wrapper (aa senior tranche)
  wrappers = [...wrappers, newWrapper];
  // update govTokensEqualLength with new gov token set as addr0
  govTokensEqualLength = [...govTokensEqualLength, addresses.addr0.toLowerCase()];
  // add IDLE distribution
  govTokens.push(addresses.IDLE);

  return {
    protocolTokens: newProtocolTokens,
    wrappers,
    govTokensEqualLength,
    govTokens
  }
};

const checkEffects = async (idleToken: any, allGovTokens: any, newWrapper: any, newProtocolToken: any, hre: any) => {
  const newGovTokens = await idleToken.getGovTokens();
  console.log('newGovTokens', newGovTokens);
  check(newGovTokens.length == allGovTokens.length, `Gov tokens length did not change`);

  let newProtocolTokens = [...(await idleToken.getAPRs())["0"]].map(x => x.toLowerCase());
  console.log('newProtocolTokens', newProtocolTokens);
  check(newProtocolTokens[newProtocolTokens.length - 1].toLowerCase() == newProtocolToken,
    `New token added is the correct one`);

  const newWrappers = [];
  for (var i = 0; i < newProtocolTokens.length; i++) {
    const token = await hre.ethers.getContractAt(ERC20_ABI, newProtocolTokens[i]);
    const wrapper = await idleToken.protocolWrappers(token.address);
    console.log(await token.name(), token.address, " => ", wrapper);

    const govToken = await idleToken.getProtocolTokenToGov(token.address)
    console.log('-- govToken: ', govToken);
    newWrappers.push(wrapper);
  };
  check(newWrappers[newWrappers.length - 1].toLowerCase() == newWrapper.toLowerCase(), `New wrapper added`);

  // Test rebalances idleDAI
  // All funds in the new protocol
  let allocations = newProtocolTokens.map((_, i) => i == newProtocolTokens.length - 1 ? 100000 : 0);
  await hre.run("test-idle-token", { idleToken, allocations })

  // All funds in the first protocol
  allocations = newProtocolTokens.map((_, i) => i == 0 ? 100000 : 0);
  await hre.run("test-idle-token", { idleToken, allocations })
}
