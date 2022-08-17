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
  const isLocalNet = hre.network.name == 'hardhat';

  // const idleAmountToTransfer = toBN(50000).mul(ONE);
  // const ecosystemFund = await hre.ethers.getContractAt(GovernableFundABI, addresses.ecosystemFund);

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
  // the difference is about 129000 IDLE that we should in part transfer to the distributor
  // and in part keep in the controller. In total we should have 180k for BY and 90k to Gauges. So we are short 
  // by about 40k IDLE that we take from ecosystemFun
  const idleFromController = toBN(49000).mul(ONE);
  const idleFromEcosystem = toBN(60000).mul(ONE);

  const idleController = await hre.ethers.getContractAt(IdleControllerAbi, addresses.idleController);
  const idleToken = await hre.ethers.getContractAt(ERC20_ABI, addresses.IDLE); // idle token    
  const distributor = await hre.ethers.getContractAt(DISTRIBUTOR_ABI, addresses.gaugeDistributor);
  const ecosystemFund = await hre.ethers.getContractAt(GovernableFundABI, addresses.ecosystemFund);

  // Get balances for tests
  const gaugeIdleBalanceBefore = await idleToken.balanceOf(addresses.gaugeDistributor);
  const controllerIdleBalanceBefore = await idleToken.balanceOf(addresses.idleController);
  const daiSpeed = await idleController.idleSpeeds(addresses.allIdleTokensBest[0]);
  const rate = await distributor.rate();

  let proposalBuilder = hre.proposals.builders.alpha();
  proposalBuilder = proposalBuilder
    .addContractAction(idleController, "_withdrawToken", [addresses.IDLE, addresses.gaugeDistributor, idleFromController])
    .addContractAction(idleController, "_setIdleRate", [newIdleControllerRate])
    .addContractAction(ecosystemFund, "transfer", [addresses.IDLE, addresses.gaugeDistributor, idleFromEcosystem])

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
  check(distributorIdleBalanceIncrease.eq(idleFromController.add(idleFromEcosystem)),
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
});