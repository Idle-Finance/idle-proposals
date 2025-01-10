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
const TIMELOCK_ABI = require("../abi/Timelock.json")

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

const iipDescription = "IIP-42: Get Leagues funding for M1 2025. Transfer Timelock ownership to TL multisig for token migration";

export default task("iip-42", iipDescription).setAction(async (_, hre) => {
  _hre = hre;
  const isLocalNet = hre.network.name == 'hardhat';
  console.log('isLocalNet', isLocalNet);

  const idle = await hre.ethers.getContractAt(ERC20_ABI, addresses.IDLE);
  const usdc = await hre.ethers.getContractAt(ERC20_ABI, addresses.USDC.live);
  const usdt = await hre.ethers.getContractAt(ERC20_ABI, addresses.USDT.live);
  const dai = await hre.ethers.getContractAt(ERC20_ABI, addresses.DAI.live);
  const comp = await hre.ethers.getContractAt(ERC20_ABI, addresses.COMP.live);
  const susd = await hre.ethers.getContractAt(ERC20_ABI, addresses.SUSD.live);
  const wbtc = await hre.ethers.getContractAt(ERC20_ABI, addresses.WBTC.live);
  const rai = await hre.ethers.getContractAt(ERC20_ABI, addresses.RAI.live);
  const tusd = await hre.ethers.getContractAt(ERC20_ABI, addresses.TUSD.live);

  const distributor = await hre.ethers.getContractAt(DISTRIBUTOR_ABI, addresses.gaugeDistributor);
  const idleController = await hre.ethers.getContractAt(IDLE_CONTROLLER_ABI, addresses.idleController);
  const ecosystemFund = await hre.ethers.getContractAt(GOVERNABLE_FUND, addresses.ecosystemFund)
  const longTermFund = await hre.ethers.getContractAt(GOVERNABLE_FUND, addresses.longTermFund)
  const feeCollector = await hre.ethers.getContractAt(FeeCollectorABI, addresses.feeCollector);
  const feeTreasury = await hre.ethers.getContractAt(GOVERNABLE_FUND, addresses.feeTreasury);
  const timelock = await hre.ethers.getContractAt(TIMELOCK_ABI, addresses.timelock);
  
  // ############# PARAMS for M1 2025 Leagues budget #############
  const fundsReceiver = addresses.treasuryMultisig;
  const fundsFrom = addresses.feeTreasury;
  const fundsFromFeeTreasury = toBN("95000").mul(ONE6);
  console.log(`📄 USDT receiver ${fundsReceiver}, amount: ${fundsFromFeeTreasury.div(ONE6)}`);

  // Get balances for tests
  const feeTreasuryUSDTBalanceBefore = await usdt.balanceOf(fundsFrom);
  const tlmultisigUSDTBalanceBefore = await usdt.balanceOf(fundsReceiver);
  // ############# END PARAMS for BUDGET ##########
  
  // ############# PARAMS for FeeCollector transfer #############
  // get funds from fee collector pre proposal
  const daiFee = toBN("351").mul(ONE);
  const compFee = toBN("298").mul(toBN(1e16));
  const usdcFee = toBN("81").mul(ONE6);
  const susdFee = toBN("51").mul(ONE);
  const wbtcFee = toBN("474").mul(toBN(1e2)); // 0.000474
  const raiFee = toBN("1317").mul(toBN(1e16));
  const tusdFee = toBN("2865").mul(toBN(1e16));
  const tlDAIPre = await dai.balanceOf(addresses.treasuryMultisig);
  const tlCOMPPre = await comp.balanceOf(addresses.treasuryMultisig);
  const tlUSDCPre = await usdc.balanceOf(addresses.treasuryMultisig);
  const tlSUSDPre = await susd.balanceOf(addresses.treasuryMultisig);
  const tlWBTCPre = await wbtc.balanceOf(addresses.treasuryMultisig);
  const tlRAIPre = await rai.balanceOf(addresses.treasuryMultisig);
  const tlTUSDPre = await tusd.balanceOf(addresses.treasuryMultisig);
  // ############# END PARAMS for FeeCollector transfer #############

  check(await timelock.pendingAdmin() == addresses.addr0, "Timelock pendingAdmin is not set");
    
  let proposalBuilder = hre.proposals.builders.alpha();
  proposalBuilder = proposalBuilder
    .addContractAction(timelock, "setPendingAdmin", [addresses.treasuryMultisig])
    .addContractAction(feeTreasury, "transfer", [addresses.USDT.live, fundsReceiver, fundsFromFeeTreasury])
    // fee collector transfers
    .addContractAction(feeCollector, "withdraw", [addresses.DAI.live, fundsReceiver, daiFee])
    .addContractAction(feeCollector, "withdraw", [addresses.COMP.live, fundsReceiver, compFee])
    .addContractAction(feeCollector, "withdraw", [addresses.USDC.live, fundsReceiver, usdcFee])
    .addContractAction(feeCollector, "withdraw", [addresses.SUSD.live, fundsReceiver, susdFee])
    .addContractAction(feeCollector, "withdraw", [addresses.WBTC.live, fundsReceiver, wbtcFee])
    .addContractAction(feeCollector, "withdraw", [addresses.RAI.live, fundsReceiver, raiFee])
    .addContractAction(feeCollector, "withdraw", [addresses.TUSD.live, fundsReceiver, tusdFee])
    
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

  // check pendingAdmin for timelock is tl multisig
  console.log('TL multisig ', addresses.treasuryMultisig);
  check(await timelock.pendingAdmin() == addresses.treasuryMultisig, "Timelock pendingAdmin set to TL multisig");

  // check that USDT funds are sent to longTermFund
  console.log('Checking USDT funds...');
  const feeTreasuryUSDTBalanceAfter = await usdt.balanceOf(fundsFrom);
  const tlmultisigUSDTBalanceAfter = await usdt.balanceOf(fundsReceiver);
  checkAlmostEqual(feeTreasuryUSDTBalanceAfter, feeTreasuryUSDTBalanceBefore.sub(fundsFromFeeTreasury), toBN(100), `USDT transferred from feeTreasury`);
  checkAlmostEqual(tlmultisigUSDTBalanceAfter, tlmultisigUSDTBalanceBefore.add(fundsFromFeeTreasury), toBN(0), `USDT transferred to tlmultisig`);

  // check funds transferred from fee collector
  console.log('Checking funds from fee collector...');
  const tlDAIPost = await dai.balanceOf(addresses.treasuryMultisig);
  const tlCOMPPost = await comp.balanceOf(addresses.treasuryMultisig);
  const tlUSDCPost = await usdc.balanceOf(addresses.treasuryMultisig);
  const tlSUSDPost = await susd.balanceOf(addresses.treasuryMultisig);
  const tlWBTCPost = await wbtc.balanceOf(addresses.treasuryMultisig);
  const tlRAIPost = await rai.balanceOf(addresses.treasuryMultisig);
  const tlTUSDPost = await tusd.balanceOf(addresses.treasuryMultisig);
  checkAlmostEqual(tlDAIPost, tlDAIPre.add(daiFee), toBN(0), `DAI transferred to TL multisig`);
  checkAlmostEqual(tlCOMPPost, tlCOMPPre.add(compFee), toBN(0), `COMP transferred to TL multisig`);
  checkAlmostEqual(tlUSDCPost, tlUSDCPre.add(usdcFee), toBN(0), `USDC transferred to TL multisig`);
  checkAlmostEqual(tlSUSDPost, tlSUSDPre.add(susdFee), toBN(0), `SUSD transferred to TL multisig`);
  checkAlmostEqual(tlWBTCPost, tlWBTCPre.add(wbtcFee), toBN(0), `WBTC transferred to TL multisig`);
  checkAlmostEqual(tlRAIPost, tlRAIPre.add(raiFee), toBN(0), `RAI transferred to TL multisig`);
  checkAlmostEqual(tlTUSDPost, tlTUSDPre.add(tusdFee), toBN(0), `TUSD transferred to TL multisig`);
});
