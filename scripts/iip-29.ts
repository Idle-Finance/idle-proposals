import { task } from "hardhat/config"
import { BigNumber } from "ethers";

const addresses = require("../common/addresses")
const ERC20_ABI = require("../abi/ERC20.json");
const IdleTokenABI = require("../abi/IdleTokenGovernance.json")
const IDLE_CONTROLLER_ABI = require("../abi/IdleController.json");
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

const iipDescription = "IIP-29: Remove idleDAI wrapper for cpFOL-USDC (DAI) senior. Same for idleUSDC with cpWIN-USDC. Remove idleRAI, idleSUSD, idleTUSD and idleFEI from IdleController. Update voting delay in Governor \n ";

export default task("iip-29", iipDescription).setAction(async (_, hre) => {
  const toEth = (val: any) => hre.ethers.utils.formatEther(val);
  const toToken = (val: any, decimals: any) => toBN(val).div(toBN(+`1e${decimals}`));
  const isLocalNet = hre.network.name == 'hardhat';
  
  const newVotingDelay = toBN(100);

  const getParamsRemoveLast = async (idleTokenAddr: any) => {
    const idleToken = await hre.ethers.getContractAt(IdleTokenABI, idleTokenAddr);
    const idleTokenName = await idleToken.name();
    console.log(`📄 adding proposal action for ${idleTokenName}`);
    
    const allGovTokens = await idleToken.getGovTokens();
    console.log('All gov tokens ', allGovTokens);
    let allProtocolTokens = [...(await idleToken.getAPRs())["0"]].map(x => x.toLowerCase())
    let protocolTokens = []
    let wrappers = []
    let govTokensEqualLength = []
    let govTokens = [];
    
    console.log(allProtocolTokens)
    // loop until allProtocolTokens.length - 2 so to remove last protocol
    for (var i = 0; i < allProtocolTokens.length - 1; i++) {
      const token = await hre.ethers.getContractAt(ERC20_ABI, allProtocolTokens[i]);
      const wrapper = await idleToken.protocolWrappers(token.address);
      console.log(await token.name(), token.address, " => ", wrapper);
      
      const govToken = await idleToken.getProtocolTokenToGov(token.address)
      if (govToken.toLowerCase() != addresses.addr0.toLowerCase()) {
        govTokens.push(govToken);
      }
      protocolTokens.push(allProtocolTokens[i]);
      wrappers.push(wrapper);
      govTokensEqualLength.push(govToken);
    };
    
    // add IDLE distribution
    govTokens.push(addresses.IDLE);
    return { 
      // params for proposal
      protocolTokens, wrappers, govTokensEqualLength, govTokens, 
      // current params
      idleToken, allProtocolTokens, allGovTokens
    };
  }

  const paramDAI = await getParamsRemoveLast(addresses.idleDAIV4);
  const paramUSDC = await getParamsRemoveLast(addresses.idleUSDCV4);

  const idleController = await hre.ethers.getContractAt(IDLE_CONTROLLER_ABI, addresses.idleController);
  const governorBravo = await hre.ethers.getContractAt(GovernorBravoDelegateABI, addresses.governorBravo);
  const proposal = hre.proposals.builders.alpha()
    .addContractAction(paramDAI.idleToken, "setAllAvailableTokensAndWrappers", [
      paramDAI.protocolTokens,
      paramDAI.wrappers,
      paramDAI.govTokens,
      paramDAI.govTokensEqualLength
    ])
    .addContractAction(paramUSDC.idleToken, "setAllAvailableTokensAndWrappers", [
      paramUSDC.protocolTokens,
      paramUSDC.wrappers,
      paramUSDC.govTokens,
      paramUSDC.govTokensEqualLength
    ])
    .addContractAction(idleController, "_dropIdleMarket", [addresses.idleFEIV4])
    .addContractAction(idleController, "_dropIdleMarket", [addresses.idleRAIV4])
    .addContractAction(idleController, "_dropIdleMarket", [addresses.idleTUSDV4])
    .addContractAction(idleController, "_dropIdleMarket", [addresses.idleSUSDV4])
    .addContractAction(governorBravo, "_setVotingDelay", [newVotingDelay]) // 100 blocks
    .setDescription(iipDescription)
    .build();

  await proposal.printProposalInfo();
  await hre.run('execute-proposal-or-simulate', { proposal, isLocalNet });

  // Skip tests in mainnet
  if (!isLocalNet) {
    return;
  }
  console.log("Checking effects...");

  const checkEffects = async (idleToken: any, allGovTokens: any, allProtocolTokens: any) => {
    const newGovTokens = await idleToken.getGovTokens();
    console.log('newGovTokens', newGovTokens);
    check(newGovTokens.length == allGovTokens.length, `Gov tokens length did not change`);

    let newProtocolTokens = [...(await idleToken.getAPRs())["0"]].map(x => x.toLowerCase());
    console.log('newProtocolTokens', newProtocolTokens);
    check(newProtocolTokens.length == (allProtocolTokens.length - 1), `token removed`);

    const newWrappers = [];
    for (var i = 0; i < newProtocolTokens.length; i++) {
      const token = await hre.ethers.getContractAt(ERC20_ABI, newProtocolTokens[i]);
      const wrapper = await idleToken.protocolWrappers(token.address);
      console.log(await token.name(), token.address, " => ", wrapper);

      const govToken = await idleToken.getProtocolTokenToGov(token.address)
      console.log('-- govToken: ', govToken);
      newWrappers.push(wrapper);
    };

    // Test rebalances 
    // All funds in the last protocol
    let allocations = newProtocolTokens.map((_, i) => i == newProtocolTokens.length - 1 ? 100000 : 0);
    await hre.run("test-idle-token", { idleToken: idleToken, allocations: allocations })

    // All funds in the first protocol
    allocations = newProtocolTokens.map((_, i) => i == 0 ? 100000 : 0);
    await hre.run("test-idle-token", { idleToken: idleToken, allocations: allocations })
  }

  await checkEffects(paramDAI.idleToken, paramDAI.allGovTokens, paramDAI.allProtocolTokens);
  await checkEffects(paramUSDC.idleToken, paramUSDC.allGovTokens, paramUSDC.allProtocolTokens);

  check(!(await idleController.markets(addresses.idleFEIV4)).isIdled, `idleFEIV4 removed`);
  check(!(await idleController.markets(addresses.idleRAIV4)).isIdled, `idleRAIV4 removed`);
  check(!(await idleController.markets(addresses.idleSUSDV4)).isIdled, `idleSUSDV4 removed`);
  check(!(await idleController.markets(addresses.idleTUSDV4)).isIdled, `idleTUSDV4 removed`);
  check(toBN(await governorBravo.votingDelay()).eq(newVotingDelay), `Voting delay updated`);
});
