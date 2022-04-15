import { task } from "hardhat/config"
import { BigNumber } from "ethers";
import { AlphaProposalBuilder } from "@idle-finance/hardhat-proposals-plugin/dist/src/proposals/compound-alpha";

const addresses = require("../common/addresses")
const STKIDLE_ABI = require("../abi/stkIDLE.json");
const ERC20_ABI = require("../abi/ERC20.json");
const DISTRIBUTOR_ABI = require("../abi/Distributor.json");
const SMART_WALLET_WHITELIST_ABI = require("../abi/SmartWalletWhitelist.json");

const toBN = function (v: any): BigNumber { return BigNumber.from(v.toString()) };
const ONE = toBN(1e18);
const check = (condition: boolean, message: string) => {
  if (condition) {
    console.log(`✅ Correct ${message}`);
  } else {
    console.log(`🚨 Incorrect ${message}`);
  }
};
const iipDescription = "IIP-22: Setup smart contract whitelist for stkIDLE \n https://gov.idle.finance/t/stkidle-whitelisting-process-implementation/958";

export default task("iip-22", iipDescription)
.setAction(async (_, hre) => {
    const impersonate = async (addr: any) => {
      await hre.network.provider.request({
        method: "hardhat_impersonateAccount", params: [addr]
      });
      await hre.network.provider.send("hardhat_setBalance", [
        addr,
        "0xffffffffffffffffffff",
      ]);
      return await hre.ethers.getSigner(addr);
    }
    const toEth = (val: any) => hre.ethers.utils.formatEther(val);
    const isLocalNet = hre.network.name == 'hardhat';
    const newSmartWhitelist = '0x2D8b5b65c6464651403955aC6D71f9c0204169D3';
    const IDLEWhale = '0x3675d2a334f17bcd4689533b7af263d48d96ec72';

    const stkIdle = await hre.ethers.getContractAt(STKIDLE_ABI, addresses.stkIDLE); // stk idle token    
    const stkIdleErc = await hre.ethers.getContractAt(ERC20_ABI, addresses.stkIDLE); // stk idle token    
    const idle = await hre.ethers.getContractAt(ERC20_ABI, addresses.IDLE); // idle token
    const smartChecker = await hre.ethers.getContractAt(SMART_WALLET_WHITELIST_ABI, newSmartWhitelist);   
  
    let proposalBuilder = hre.proposals.builders.alpha();
    proposalBuilder = proposalBuilder
      .addContractAction(stkIdle, "commit_smart_wallet_checker", [newSmartWhitelist])
      .addContractAction(stkIdle, "apply_smart_wallet_checker", []);

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

    // Check that smart wallet checker address is correct
    const res = await stkIdle.smart_wallet_checker();
    check(res.toLowerCase() == newSmartWhitelist.toLowerCase(),
      `Smart wallet checker changed to ${res}`);

    // Deploy fake contract for interacting with stkIDLE
    const StkIdleIntegrator = await hre.ethers.getContractFactory("StkIdleIntegrator");
    const integ = await StkIdleIntegrator.deploy();
    await integ.deployed();
    console.log("Integration contract deployed at: ", integ.address);
    // send some idle to the integration contract
    let signer = await impersonate(IDLEWhale);
    await idle.connect(signer).transfer(integ.address, toBN(1e18));
    // Check that still no contracts can do actions 
    const resCheck = await smartChecker.check(integ.address);
    check(!resCheck, 
      `Smart contracts still not allowed`);

    try {
      await integ.createLock();
    } catch (error:any) {
      console.log('✅ Contract is not allowed: ', error.message);
    }
    
    // Toggle a single address to be whitelisted 
    signer = await impersonate(addresses.treasuryMultisig);
    await smartChecker.connect(signer).toggleAddress(integ.address, true);
    await integ.createLock();
    const stkIdleBak = await stkIdleErc.balanceOf(integ.address);
    check(toBN(stkIdleBak).gt(toBN(0)),
      `Selected smart contracts are now allowed`);

    // but not all smart contracts
    const integ2 = await StkIdleIntegrator.deploy();
    await integ2.deployed();
    signer = await impersonate(IDLEWhale);
    await idle.connect(signer).transfer(integ2.address, toBN(1e18));

    try {
      await integ2.createLock();
    } catch (error:any) {
      console.log('✅ Catched error ok not all allowed: ', error.message);
    }

    // Let every contract in
    signer = await impersonate(addresses.treasuryMultisig);
    await smartChecker.connect(signer).toggleIsOpen(true);

    await integ2.createLock();
    const stkIdleBak2 = await stkIdleErc.balanceOf(integ.address);
    check(toBN(stkIdleBak2).gt(toBN(0)),
      `All smart contracts are now allowed`);
  });