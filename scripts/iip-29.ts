import { task } from "hardhat/config"
import { BigNumber } from "ethers";
import { AlphaProposalBuilder } from "@idle-finance/hardhat-proposals-plugin/dist/src/proposals/compound-alpha";

const DISTRIBUTOR_ABI = require("../abi/Distributor.json");
const addresses = require("../common/addresses")
const ERC20_ABI = require("../abi/ERC20.json");
const IdleTokenABI = require("../abi/IdleTokenGovernance.json")
const PriceOracleV3ABI = require("../abi/PriceOracleV3.json")
const IDLE_CONTROLLER_ABI = require("../abi/IdleController.json");

const toBN = function (v: any): BigNumber { return BigNumber.from(v.toString()) };
const ONE = toBN(1e18);
const check = (condition: boolean, message: string) => {
  if (condition) {
    console.log(`✅ Correct ${message}`);
  } else {
    console.log(`🚨 Incorrect ${message}`);
  }
};

const iipDescription = "IIP-29: Add idleDAI wrapper for rWIN-USDC (DAI) senior tranche. Remove idleRAI, idleSUSD, idleTUSD and idleFEI from IdleController. \n ";

export default task("iip-29", iipDescription).setAction(async (_, hre) => {
  const toEth = (val: any) => hre.ethers.utils.formatEther(val);
  const toToken = (val: any, decimals: any) => toBN(val).div(toBN(+`1e${decimals}`));
  const isLocalNet = hre.network.name == 'hardhat';

  const idleToken = await hre.ethers.getContractAt(IdleTokenABI, addresses.idleDAIV4);
  const idleTokenName = await idleToken.name();
  console.log(`📄 adding proposal action for ${idleTokenName}`);

  const allGovTokens = await idleToken.getGovTokens();
  console.log('All gov tokens', allGovTokens);

  const clearPoolWrapper = '0x75DA360514532813B460b2Ba30F444A1fa28c9d7';
  const newProtocolToken = addresses.AA_rWIN_DAI.live;
  let protocolTokens = [...(await idleToken.getAPRs())["0"]].map(x => x.toLowerCase())
  let wrappers = []
  let govTokensEqualLength = []
  let govTokens = [];

  console.log(protocolTokens)
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

  const idleController = await hre.ethers.getContractAt(IDLE_CONTROLLER_ABI, addresses.idleController);

  // add new protocol token and its wrapper
  protocolTokens = [...protocolTokens, newProtocolToken];
  wrappers = [...wrappers, clearPoolWrapper];
  govTokensEqualLength = [...govTokensEqualLength, addresses.addr0];
  // add IDLE distribution
  govTokens.push(addresses.IDLE);

  let proposalBuilder = hre.proposals.builders.alpha();
  proposalBuilder = proposalBuilder.addContractAction(idleToken, "setAllAvailableTokensAndWrappers", [
    protocolTokens,
    wrappers,
    govTokens,
    govTokensEqualLength
  ])
  .addContractAction(idleController, "_dropIdleMarket", [addresses.idleFEIV4])
  .addContractAction(idleController, "_dropIdleMarket", [addresses.idleRAIV4])
  .addContractAction(idleController, "_dropIdleMarket", [addresses.idleTUSDV4])
  .addContractAction(idleController, "_dropIdleMarket", [addresses.idleSUSDV4])

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

  const newGovTokens = await idleToken.getGovTokens();
  console.log('newGovTokens', newGovTokens);
  check(newGovTokens.length == allGovTokens.length, `Gov tokens length did not change`);

  let newProtocolTokens = [...(await idleToken.getAPRs())["0"]].map(x => x.toLowerCase());
  console.log('newProtocolTokens', newProtocolTokens);
  check(newProtocolTokens[newProtocolTokens.length - 1].toLowerCase() == newProtocolToken.toLowerCase(),
    `New token added is correct`);

  const newWrappers = [];
  for (var i = 0; i < newProtocolTokens.length; i++) {
    const token = await hre.ethers.getContractAt(ERC20_ABI, newProtocolTokens[i]);
    const wrapper = await idleToken.protocolWrappers(token.address);
    console.log(await token.name(), token.address, " => ", wrapper);

    const govToken = await idleToken.getProtocolTokenToGov(token.address)
    console.log('-- govToken: ', govToken);
    newWrappers.push(wrapper);
  };
  check(!(await idleController.markets(addresses.idleFEIV4)).isIdled, `idleFEIV4 removed`);
  check(!(await idleController.markets(addresses.idleRAIV4)).isIdled, `idleRAIV4 removed`);
  check(!(await idleController.markets(addresses.idleSUSDV4)).isIdled, `idleSUSDV4 removed`);
  check(!(await idleController.markets(addresses.idleTUSDV4)).isIdled, `idleTUSDV4 removed`);

  // Test rebalances
  // All funds in the new protocol
  let allocations = newProtocolTokens.map((_, i) => i == newProtocolTokens.length - 1 ? 100000 : 0);
  await hre.run("test-idle-token", { idleToken, allocations })

  // All funds in the first protocol
  allocations = newProtocolTokens.map((_, i) => i == 0 ? 100000 : 0);
  await hre.run("test-idle-token", { idleToken, allocations })
});
