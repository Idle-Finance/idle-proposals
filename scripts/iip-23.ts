import { task } from "hardhat/config"
import { BigNumber } from "ethers";
import { AlphaProposalBuilder } from "@idle-finance/hardhat-proposals-plugin/dist/src/proposals/compound-alpha";

const DISTRIBUTOR_ABI = require("../abi/Distributor.json");
const addresses = require("../common/addresses")
const ERC20_ABI = require("../abi/ERC20.json");
const IdleControllerAbi = require("../abi/IdleController.json");
const UnitrollerAbi = require("../abi/Unitroller.json");
const FeeCollectorABI = require("../abi/FeeCollector.json")
const GovernableFundABI = require("../abi/GovernableFund.json");
const GovernorBravoDelegateABI = require("../abi/GovernorBravoDelegate.json");

const toBN = function (v: any): BigNumber { return BigNumber.from(v.toString()) };
const ONE = toBN(1e18);
const check = (condition: boolean, message: string) => {
  if (condition) {
    console.log(`✅ Correct ${message}`);
  } else {
    console.log(`🚨 Incorrect ${message}`);
  }
};

const iipDescription = "IIP-23: Reduce LM for Best Yield to 1000 IDLE/day \n https://gov.idle.finance/t/idle-incentives-distribution-update/1030";

export default task("iip-23", iipDescription)
.setAction(async (_, hre) => {
  const toEth = (val: any) => hre.ethers.utils.formatEther(val);
  const toToken = (val: any, decimals: any) => toBN(val).div(toBN(+`1e${decimals}`));
  const isLocalNet = hre.network.name == 'hardhat';
  // we should move some funds from IdleController to the distributor
  // in order to reduce the LM for the best yield to 1000 IDLE / day.
  // Funds should be used to extend the distribution period for both LM and BY to around Feb 26th 2023.
  
  // we have 31536000 seconds in a year
  // using 13.3 seconds as blocktime we have about 2371127 blocks or about 6586 / day
  // we count 26th august as execution time for this IIP, so we have about 3 months of 
  // IDLE rewards left in the IdleController (end was planned for ~26th November)
  // so we have 1000 / 6586 = 0.15183723048 per block as new rate
  // total spending will be 1000 * 90 = 90000 IDLE to arrive to Nov 26th + 90k IDLE to extend the distribution period to Feb 26th
  const newIdleControllerRate = toBN('151837230480000000');
  // current distribution is 0.3875 per block so about 2552 IDLE per day, so a total of 2552 * 90 = 229680 IDLE
  // the difference is about 229k - 180k = 49k IDLE that we should transfer to the distributor
  // In total we should have 180k for BY and 90k to Gauges. So we are short 
  // by about 40k IDLE that we take from ecosystemFund + ~20k which are already missing
  
  // we can reduce the duration by 20 days, so we would need 90k + 70k = 160k IDLE for BY and 69k for Gauges 
  // (+20k missing that will be taken from TL multisig)
  const idleFromController = toBN(69000).mul(ONE);

  // IIP should also transfer the following amounts to the Treasury League Multisig
  const stkAAVEFromCollector = toBN(998).mul(toBN(1e17)); // 99.8
  const wethFromTreasury = toBN(55).mul(toBN(1e17)); // 5.5
  const compFromTreasury = toBN(397).mul(toBN(1e17)); // 39.7
  const usdtFromTreasury = toBN(1467).mul(1e6); // 1467
  const daiFromTreasury = toBN(1007).mul(ONE); // 1007
  
  const idleController = await hre.ethers.getContractAt(IdleControllerAbi, addresses.idleController);
  const idleToken = await hre.ethers.getContractAt(ERC20_ABI, addresses.IDLE); // idle token    
  const weth = await hre.ethers.getContractAt(ERC20_ABI, addresses.WETH.live); // WETH    
  const stkAAVE = await hre.ethers.getContractAt(ERC20_ABI, addresses.stkAAVE.live); // stkAAVE    
  const comp = await hre.ethers.getContractAt(ERC20_ABI, addresses.COMP.live); // COMP    
  const dai = await hre.ethers.getContractAt(ERC20_ABI, addresses.DAI.live); // DAI    
  const usdt = await hre.ethers.getContractAt(ERC20_ABI, addresses.USDT.live); // USDT    
  const distributor = await hre.ethers.getContractAt(DISTRIBUTOR_ABI, addresses.gaugeDistributor);
  const feeCollector = await hre.ethers.getContractAt(FeeCollectorABI, addresses.feeCollector);
  const feeTreasury = await hre.ethers.getContractAt(GovernableFundABI, addresses.feeTreasury);
  
  // Get balances for tests
  const tlMultisigWethBalanceBefore = await weth.balanceOf(addresses.treasuryMultisig);
  const tlMultisigAAVEBalanceBefore = await stkAAVE.balanceOf(addresses.treasuryMultisig);
  const tlMultisigCOMPBalanceBefore = await comp.balanceOf(addresses.treasuryMultisig);
  const tlMultisigDAIBalanceBefore = await dai.balanceOf(addresses.treasuryMultisig);
  const tlMultisigUSDTBalanceBefore = await usdt.balanceOf(addresses.treasuryMultisig);
  const gaugeIdleBalanceBefore = await idleToken.balanceOf(addresses.gaugeDistributor);
  const controllerIdleBalanceBefore = await idleToken.balanceOf(addresses.idleController);
  const daiSpeed = await idleController.idleSpeeds(addresses.allIdleTokensBest[0]);
  const rate = await distributor.rate();

  let proposalBuilder = hre.proposals.builders.alpha();
  proposalBuilder = proposalBuilder
    .addContractAction(idleController, "_withdrawToken", [addresses.IDLE, addresses.gaugeDistributor, idleFromController])
    .addContractAction(idleController, "_setIdleRate", [newIdleControllerRate])
    .addContractAction(feeCollector, "withdraw", [addresses.stkAAVE.live, addresses.treasuryMultisig, stkAAVEFromCollector])
    .addContractAction(feeTreasury, "transfer", [addresses.WETH.live, addresses.treasuryMultisig, wethFromTreasury])
    .addContractAction(feeTreasury, "transfer", [addresses.DAI.live, addresses.treasuryMultisig, daiFromTreasury])
    .addContractAction(feeTreasury, "transfer", [addresses.COMP.live, addresses.treasuryMultisig, compFromTreasury])
    .addContractAction(feeTreasury, "transfer", [addresses.USDT.live, addresses.treasuryMultisig, usdtFromTreasury])

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

  // Check that balance is changed on IdleController 
  const controllerIdleBalanceAfter = await idleToken.balanceOf(addresses.idleController);
  const controllerIdleBalanceDecrease = controllerIdleBalanceBefore.sub(controllerIdleBalanceAfter);
  check(controllerIdleBalanceDecrease.eq(idleFromController),
    `Controller balance ${toEth(controllerIdleBalanceBefore)} -> ${toEth(controllerIdleBalanceAfter)} (- ${toEth(controllerIdleBalanceDecrease)})`);

  // Check that balance is changed on gauge Distributor 
  const gaugeIdleBalanceAfter = await idleToken.balanceOf(addresses.gaugeDistributor);
  const distributorIdleBalanceIncrease = gaugeIdleBalanceAfter.sub(gaugeIdleBalanceBefore);
  check(distributorIdleBalanceIncrease.eq(idleFromController),
    `Distributor balance ${toEth(gaugeIdleBalanceBefore)} -> ${toEth(gaugeIdleBalanceAfter)} (+ ${toEth(distributorIdleBalanceIncrease)})`);

  // check that idleController rate is changed
  const idleControllerRate = await idleController.idleRate();
  check(idleControllerRate.eq(newIdleControllerRate),
    `IdleController rate changed ${idleControllerRate}`);

  const idleDAI = addresses.allIdleTokensBest[0];
  // Check that speed changed for idle tokens
  const daiSpeedAfter = await idleController.idleSpeeds(idleDAI);
  check(!daiSpeedAfter.eq(daiSpeed),
    `IdleController speed changed for dai ${daiSpeed} -> ${daiSpeedAfter}`);

  // Check that claimIdle is still working for dai
  const balBefore = await idleToken.balanceOf(idleDAI);
  await idleController.claimIdle([], [idleDAI]);
  const balAfter = await idleToken.balanceOf(idleDAI);
  // balance should increase
  check(balAfter.gt(balBefore),
    `IDLE after claimIdle increased ${balBefore} -> ${balAfter}`);

  // mine 8 months of blocks (considering blocknumber 14474950 for fork), 
  // ie 8 * 30 * 6400 = 1536000 blocks (in hex is 0x177000)
  await hre.network.provider.send("hardhat_mine", ["0x177000"]);
  // last claimIdle should be executed
  const daiBal = await idleToken.balanceOf(idleDAI);
  await idleController.claimIdle([], [idleDAI]);
  const daiBal2 = await idleToken.balanceOf(idleDAI);
  // balance should increase
  check(daiBal2.gt(daiBal),
    `IDLE after claimIdle increased ${daiBal} -> ${daiBal2}`);

  // mine 1 more month of blocks, ie 30 * 6400 = 192000 blocks (0x1646592)
  await hre.network.provider.send("hardhat_mine", ["0x1646592"]);
  // This claim should give 0 IDLE
  const daiBalBefore = await idleToken.balanceOf(idleDAI);
  await idleController.claimIdle([], [idleDAI]);
  const daiBalAfter = await idleToken.balanceOf(idleDAI);
  check(daiBalAfter.eq(daiBalBefore),
    `IDLE after claimIdle equal ${daiBalBefore} -> ${daiBalAfter}`);
  
  // Check balances for TL multisig
  // Check stkAAVE balance
  const tlMultisigAAVEBalanceAfter = await stkAAVE.balanceOf(addresses.treasuryMultisig);
  const tlMultisigIncreaseAAVE = tlMultisigAAVEBalanceAfter.sub(tlMultisigAAVEBalanceBefore);
  check(tlMultisigIncreaseAAVE.eq(stkAAVEFromCollector),
    `TL multisig stkAAVE balance ${toEth(tlMultisigAAVEBalanceBefore)} -> ${toEth(tlMultisigAAVEBalanceAfter)} (+ ${toEth(tlMultisigIncreaseAAVE)})`);
  // Check weth
  const tlMultisigWethBalanceAfter = await weth.balanceOf(addresses.treasuryMultisig);
  const tlMultisigIncreaseWeth = tlMultisigWethBalanceAfter.sub(tlMultisigWethBalanceBefore);
  check(tlMultisigIncreaseWeth.eq(wethFromTreasury),
    `TL multisig WETH balance ${toEth(tlMultisigWethBalanceBefore)} -> ${toEth(tlMultisigWethBalanceAfter)} (+ ${toEth(tlMultisigIncreaseWeth)})`);
  // Check dai
  const tlMultisigDAIBalanceAfter = await dai.balanceOf(addresses.treasuryMultisig);
  const tlMultisigIncreaseDAI = tlMultisigDAIBalanceAfter.sub(tlMultisigDAIBalanceBefore);
  check(tlMultisigIncreaseDAI.eq(daiFromTreasury),
    `TL multisig DAI balance ${toEth(tlMultisigDAIBalanceBefore)} -> ${toEth(tlMultisigDAIBalanceAfter)} (+ ${toEth(tlMultisigIncreaseDAI)})`);
  // Check usdt
  const tlMultisigUSDTBalanceAfter = await usdt.balanceOf(addresses.treasuryMultisig);
  const tlMultisigIncreaseUSDT = tlMultisigUSDTBalanceAfter.sub(tlMultisigUSDTBalanceBefore);
  check(tlMultisigIncreaseUSDT.eq(usdtFromTreasury),
    `TL multisig USDT balance ${toToken(tlMultisigUSDTBalanceBefore, 6)} -> ${toToken(tlMultisigUSDTBalanceAfter, 6)} (+ ${toToken(tlMultisigIncreaseUSDT, 6)})`);
  // Check comp
  const tlMultisigCOMPBalanceAfter = await comp.balanceOf(addresses.treasuryMultisig);
  const tlMultisigIncreaseCOMP = tlMultisigCOMPBalanceAfter.sub(tlMultisigCOMPBalanceBefore);
  check(tlMultisigIncreaseCOMP.eq(compFromTreasury),
    `TL multisig COMP balance ${toEth(tlMultisigCOMPBalanceBefore)} -> ${toEth(tlMultisigCOMPBalanceAfter)} (+ ${toEth(tlMultisigIncreaseUSDT)})`);
});