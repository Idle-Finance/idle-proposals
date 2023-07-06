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

const iipDescription = "IIP-37: Fasanara deal 150k USDC for 150k IDLE. M3 Leagues IDLE budget";

export default task("iip-37", iipDescription).setAction(async (_, hre) => {
  _hre = hre;
  const isLocalNet = hre.network.name == 'hardhat';

  const usdc = await hre.ethers.getContractAt(ERC20_ABI, addresses.USDC.live); // USDC 
  const idle = await hre.ethers.getContractAt(ERC20_ABI, addresses.IDLE);
  const ecosystemFund = await hre.ethers.getContractAt(GOVERNABLE_FUND, addresses.ecosystemFund)
  const feeTreasury = await hre.ethers.getContractAt(GOVERNABLE_FUND, addresses.feeTreasury);
  // ############# PARAMS #############
  const USDCAmountFromFeeTreasury = toBN(150000).mul(toBN(1e6)); // 150_000 USDC
  const IDLEAmountFromEcosys = toBN(337791).mul(ONE); // 337_791 IDLE
  const receiver = addresses.treasuryMultisig;
  // ############# END PARAMS ##########

  // we need to:
  // - get IDLE from ecosystem fund to TL multisig
  // - get USDC from feeTreasury to TL multisig
  console.log(`📄 Receiver ${receiver}`);
  console.log(`📄 USDC amount ${USDCAmountFromFeeTreasury}`);
  console.log(`📄 IDLE amount ${IDLEAmountFromEcosys}`);

  // Get balances for tests
  const receiverUSDCBalanceBefore = await usdc.balanceOf(receiver);
  const receiverIDLEBalanceBefore = await idle.balanceOf(receiver);

  console.log('IDLE balance pre', receiverIDLEBalanceBefore.div(ONE).toString());
  console.log('USDC balance pre', receiverUSDCBalanceBefore.div(toBN(1e6)).toString());
  // ############# END PARAMS for BUDGET ##########

  let proposalBuilder = hre.proposals.builders.alpha();
  proposalBuilder = proposalBuilder
    .addContractAction(ecosystemFund, "transfer", [addresses.IDLE, receiver, IDLEAmountFromEcosys])
    .addContractAction(feeTreasury, "transfer", [addresses.USDC.live, receiver, USDCAmountFromFeeTreasury])
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

  console.log('Checking funds');
  const receiverUSDCBalanceAfter = await usdc.balanceOf(receiver);
  checkAlmostEqual(receiverUSDCBalanceAfter, receiverUSDCBalanceBefore.add(USDCAmountFromFeeTreasury), toBN(0), `USDC transferred to receiver`);
  const receiverIDLEBalanceAfter = await idle.balanceOf(receiver);
  checkAlmostEqual(receiverIDLEBalanceAfter, receiverIDLEBalanceBefore.add(IDLEAmountFromEcosys), toBN(0), `IDLE transferred to receiver`);

  console.log('IDLE balance pos', receiverIDLEBalanceAfter.div(ONE).toString());
  console.log('USDC balance pos', receiverUSDCBalanceAfter.div(toBN(1e6)).toString());
});
