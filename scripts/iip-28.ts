import { task } from "hardhat/config"
import { BigNumber } from "ethers";
import { AlphaProposalBuilder } from "@idle-finance/hardhat-proposals-plugin/dist/src/proposals/compound-alpha";

const DISTRIBUTOR_ABI = require("../abi/Distributor.json");
const addresses = require("../common/addresses")
const ERC20_ABI = require("../abi/ERC20.json");
const IdleTokenABI = require("../abi/IdleTokenGovernance.json")
const PriceOracleV3ABI = require("../abi/PriceOracleV3.json")
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

const iipDescription = "IIP-28: Update idleDAI wrapper for cpFOL-USDC (DAI) senior tranche and idleUSDC wrapper for cpWIN-USDC to fix availableLiquidity \n https://gov.idle.finance/t/iip-28-update-by-wrapper-contracts/1087";

export default task("iip-28", iipDescription).setAction(async (_, hre) => {
  _hre = hre;
  const isLocalNet = hre.network.name == 'hardhat';

  const idleToken = await hre.ethers.getContractAt(IdleTokenABI, addresses.idleDAIV4);
  const idleTokenUSDC = await hre.ethers.getContractAt(IdleTokenABI, addresses.idleUSDCV4);
  const idleTokenName = await idleToken.name();
  const idleTokenUSDCName = await idleTokenUSDC.name();
  console.log(`📄 adding proposal action for ${idleTokenName}`);
  
  const allGovTokens = await idleToken.getGovTokens();
  console.log('All gov tokens (DAI)', allGovTokens);
  const allGovTokensUSDC = await idleTokenUSDC.getGovTokens();
  console.log('All gov tokens (USDC)', allGovTokensUSDC);

  // idleDAI updated wrapper
  const clearPoolWrapper = '0xDd585E6e3AcB30594E7b70DCee34400E172cee31';
  // idleUSDC updated wrapper
  const clearPoolWrapperUSDC = '0xFF12A5eaE3E60096c774AD7211AE5C0c5b5Cc0F5';

  const paramDAI = await getParamsForSetAll(idleToken, clearPoolWrapper, hre);
  const paramUSDC = await getParamsForSetAll(idleTokenUSDC, clearPoolWrapperUSDC, hre);
  
  let proposalBuilder = hre.proposals.builders.alpha();
  proposalBuilder = proposalBuilder.addContractAction(idleToken, "setAllAvailableTokensAndWrappers", [
    paramDAI.protocolTokens,
    paramDAI.wrappers,
    paramDAI.govTokens,
    paramDAI.govTokensEqualLength
  ])
  .addContractAction(idleTokenUSDC, "setAllAvailableTokensAndWrappers", [
    paramUSDC.protocolTokens,
    paramUSDC.wrappers,
    paramUSDC.govTokens,
    paramUSDC.govTokensEqualLength
  ])
  
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

  await checkEffects(idleToken, allGovTokens, clearPoolWrapper, addresses.AA_cpFOL_DAI.live.toLowerCase(), hre);
  await checkEffects(idleTokenUSDC, allGovTokensUSDC, clearPoolWrapperUSDC, addresses.AA_cpWIN_USDC.live.toLowerCase(), hre);
});

const getParamsForSetAll = async (idleToken: any, newWrapper: any, hre: any) => {
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

  // update last wrapper (aa senior tranche)
  wrappers = [...wrappers.slice(0, wrappers.length - 1), newWrapper];
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
    `New token added is AA_cpFOL_DAI`);

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
