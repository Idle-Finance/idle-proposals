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

const iipDescription = "IIP-32: Add Euler staking PYT wrappers for AA tranche to IdleDAI";

export default task("iip-32", iipDescription).setAction(async (_, hre) => {
  _hre = hre;
  const isLocalNet = hre.network.name == 'hardhat';

  const idle = await hre.ethers.getContractAt(ERC20_ABI, addresses.IDLE);
  const distributor = await hre.ethers.getContractAt(DISTRIBUTOR_ABI, addresses.gaugeDistributor);
  const idleController = await hre.ethers.getContractAt(IDLE_CONTROLLER_ABI, addresses.idleController);
  const ecosystemFund = await hre.ethers.getContractAt(GOVERNABLE_FUND, addresses.ecosystemFund)
  
  const idleToken = await hre.ethers.getContractAt(IdleTokenABI, addresses.idleDAIV4);
  const idleTokenName = await idleToken.name();
  console.log(`📄 adding proposal action for ${idleTokenName}`);
  
  const allGovTokens = await idleToken.getGovTokens();
  console.log('All gov tokens (DAI)', allGovTokens);
  
  // ############# PARAMS #############
  // New wrappers for aa tranches
  const wrapper = '0xC9C83bEBd31aff93a2353920F2513D372847A517'; // DAI
  // New protocol tokens
  const protocolToken = addresses.AA_eDAIStaking.live.toLowerCase();
  // ############# END PARAMS ##########

  const paramDAI = await getParamsForSetAll(idleToken, wrapper, protocolToken, hre);
  
  let proposalBuilder = hre.proposals.builders.alpha();
  proposalBuilder = proposalBuilder
    .addContractAction(idleToken, "setAllAvailableTokensAndWrappers", [
      paramDAI.protocolTokens,
      paramDAI.wrappers,
      paramDAI.govTokens,
      paramDAI.govTokensEqualLength
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

  // Check that new protocols are added
  await checkEffects(idleToken, allGovTokens, wrapper, protocolToken, hre);
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
