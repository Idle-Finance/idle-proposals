import { task } from "hardhat/config"
import { BigNumber } from "ethers";

const DISTRIBUTOR_ABI = require("../abi/Distributor.json");
const addresses = require("../common/addresses")
const GOVERNABLE_FUND = require("../abi/GovernableFund.json");
const ERC20_ABI = require("../abi/ERC20.json");
const IdleTokenABI = require("../abi/IdleTokenGovernance.json")
const IDLE_CONTROLLER_ABI = require("../abi/IdleController.json");
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

const iipDescription = "IIP-31: Add AA Euler staking PYT wrappers to IdleUSDT, IdleUSDC and IdleWETH. Set Gauges rate to 0. Extend LM (IdleController) for 3 months at half rate.";

export default task("iip-31", iipDescription).setAction(async (_, hre) => {
  _hre = hre;
  const isLocalNet = hre.network.name == 'hardhat';

  const idle = await hre.ethers.getContractAt(ERC20_ABI, addresses.IDLE);
  const distributor = await hre.ethers.getContractAt(DISTRIBUTOR_ABI, addresses.gaugeDistributor);
  const idleController = await hre.ethers.getContractAt(IDLE_CONTROLLER_ABI, addresses.idleController);
  const ecosystemFund = await hre.ethers.getContractAt(GOVERNABLE_FUND, addresses.ecosystemFund)
  
  const idleToken = await hre.ethers.getContractAt(IdleTokenABI, addresses.idleUSDTV4);
  const idleTokenUSDC = await hre.ethers.getContractAt(IdleTokenABI, addresses.idleUSDCV4);
  const idleTokenWETH = await hre.ethers.getContractAt(IdleTokenABI, addresses.idleWETHV4);
  const idleTokenName = await idleToken.name();
  const idleTokenUSDCName = await idleTokenUSDC.name();
  const idleTokenWETHName = await idleTokenWETH.name();
  console.log(`📄 adding proposal action for ${idleTokenName}, ${idleTokenUSDCName} and ${idleTokenWETHName}`);
  
  const allGovTokens = await idleToken.getGovTokens();
  console.log('All gov tokens (USDT)', allGovTokens);
  const allGovTokensUSDC = await idleTokenUSDC.getGovTokens();
  console.log('All gov tokens (USDC)', allGovTokensUSDC);
  const allGovTokensWETH = await idleTokenWETH.getGovTokens();
  console.log('All gov tokens (WETH)', allGovTokensWETH);
  
  // ############# PARAMS #############
  // 500 IDLE / day for 3 months (half of the current rate) -> 500 * 30 * 3 = 45k IDLE
  const newLMFunds = toBN("45000").mul(ONE);
  // rate is per block so 500 / 7160 = 0.0698324 with 7160 being the blocks per day
  const newControllerRate = toBN("500").mul(ONE).div(toBN("7160"));
  // New wrappers for aa tranches
  const wrapper = '0xAB3919896975F43A81325B0Ca98b72249E714e6C'; // USDT
  const wrapperUSDC = '0x6C1a844E3077e6C39226C15b857436a6a92Be5C0';
  const wrapperWETH = '0xC24e0dd3A0Bc6f19aEEc2d7985dd3940D59dB698';
  // New protocol tokens
  const protocolToken = addresses.AA_eUSDTStaking.live.toLowerCase();
  const protocolTokenUSDC = addresses.AA_eUSDCStaking.live.toLowerCase();
  const protocolTokenWETH = addresses.AA_eWETHStaking.live.toLowerCase();
  // ############# END PARAMS ##########

  const paramUSDT = await getParamsForSetAll(idleToken, wrapper, protocolToken, hre);
  const paramUSDC = await getParamsForSetAll(idleTokenUSDC, wrapperUSDC, protocolTokenUSDC, hre);
  const paramWETH = await getParamsForSetAll(idleTokenWETH, wrapperWETH, protocolTokenWETH, hre);
  
  let proposalBuilder = hre.proposals.builders.alpha();
  proposalBuilder = proposalBuilder
    .addContractAction(idleToken, "setAllAvailableTokensAndWrappers", [
      paramUSDT.protocolTokens,
      paramUSDT.wrappers,
      paramUSDT.govTokens,
      paramUSDT.govTokensEqualLength
    ])
    .addContractAction(idleTokenUSDC, "setAllAvailableTokensAndWrappers", [
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
    .addContractAction(distributor, "setPendingRate", [
      toBN(0)
    ])
    .addContractAction(ecosystemFund, "transfer", [
      addresses.IDLE, 
      addresses.idleController, 
      newLMFunds
    ])
    .addContractAction(idleController, "_setIdleRate", [
      newControllerRate
    ])
  
  // call refreshIdleSpeeds of idleController manually to update speeds
  await idleController.refreshIdleSpeeds();

  // get idleDAI, idleUSDC and idleUSDT speeds from controller before proposal
  const idleDAISpeedBefore = await idleController.idleSpeeds(addresses.idleDAIV4);
  const idleUSDCSpeedBefore = await idleController.idleSpeeds(addresses.idleUSDCV4);
  const idleUSDTSpeedBefore = await idleController.idleSpeeds(addresses.idleUSDTV4);
  // get IDLE balance of idleController before proposal
  const idleControllerBalanceBefore = await idle.balanceOf(idleController.address);

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

  // Check that idleDAI, idleUSDC and idleUSDT speeds are half than before, with 5% tolerance
  const idleDAISpeedAfter = await idleController.idleSpeeds(addresses.idleDAIV4);
  checkAlmostEqual(idleDAISpeedAfter, idleDAISpeedBefore.div(toBN(2)), toBN(5), `idleDAI speed is half than before`);

  const idleUSDCSpeedAfter = await idleController.idleSpeeds(addresses.idleUSDCV4);
  checkAlmostEqual(idleUSDCSpeedAfter, idleUSDCSpeedBefore.div(toBN(2)), toBN(5), `idleUSDC speed is half than before`);

  const idleUSDTSpeedAfter = await idleController.idleSpeeds(addresses.idleUSDTV4);
  checkAlmostEqual(idleUSDTSpeedAfter, idleUSDTSpeedBefore.div(toBN(2)), toBN(5), `idleUSDT speed is half than before`);

  // Check that idleController balance increased by newLMFunds
  const idleControllerBalanceAfter = await idle.balanceOf(idleController.address);
  check(idleControllerBalanceAfter.eq(idleControllerBalanceBefore.add(newLMFunds)), 
    `idleController balance increased by ${newLMFunds.div(toBN(1e18))} IDLE`);
  
  // Check that idleController rate is newControllerRate
  check(toBN(await idleController.idleRate()).eq(newControllerRate), `idleController rate is ${newControllerRate}}`);

  // Check Gauges rate
  // skip time and update epoch
  await hre.network.provider.send("evm_increaseTime", [86400 * 7]);
  await hre.network.provider.send("evm_mine", []);
  await distributor.updateDistributionParameters();
  check(toBN(await distributor.rate()).eq(toBN(0)), `IDLE Distribution rate is 0 for Gauges`);

  const idleControllerBalanceAfter3Months = await idle.balanceOf(idleController.address);
  check(idleControllerBalanceAfter3Months.eq(toBN(0)), `idleController balance is 0 after 3 months`);

  // Check that new protocols are added
  await checkEffects(idleToken, allGovTokens, wrapper, protocolToken, hre);
  await checkEffects(idleTokenUSDC, allGovTokensUSDC, wrapperUSDC, protocolTokenUSDC, hre);
  await checkEffects(idleTokenWETH, allGovTokensWETH, wrapperWETH, protocolTokenWETH, hre);
});

const getParamsForSetAll = async (idleToken: any, newWrapper: any, newProtocolToken: any, hre: any) => {
  let protocolTokens = [...(await idleToken.getAPRs())["0"]].map(x => x.toLowerCase())
  let wrappers = []
  let govTokensEqualLength = []
  let govTokens = [];

  console.log('protocolTokens', protocolTokens);
  for (var i = 0; i < protocolTokens.length; i++) {
    const token = await hre.ethers.getContractAt(ERC20_ABI, protocolTokens[i]);
    const wrapper = await idleToken.protocolWrappers(token.address);
    console.log(await token.name(), token.address, " => ", wrapper);

    const govToken = await idleToken.getProtocolTokenToGov(token.address)
    if (govToken.toLowerCase() != addresses.addr0.toLowerCase()) {
      govTokens.push(govToken);
    }
    wrappers.push(wrapper);
    govTokensEqualLength.push(govToken);
  };

  // update protocol tokens with new protocol token
  protocolTokens = [...protocolTokens, newProtocolToken];
  // update last wrapper (aa senior tranche)
  wrappers = [...wrappers, newWrapper];
  // update govTokensEqualLength with new gov token set as addr0
  govTokensEqualLength = [...govTokensEqualLength, addresses.addr0.toLowerCase()];
  // add IDLE distribution
  govTokens.push(addresses.IDLE);

  return {
    protocolTokens,
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
