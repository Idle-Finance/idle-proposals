import { BigNumber, Contract } from "ethers";
import { task } from "hardhat/config"

const ERC20_ABI = require("../abi/ERC20.json")
const addresses = require("../common/addresses")
const toBN = function(v: any): BigNumber { return BigNumber.from(v.toString()) };

export default task("test-idle-token", "Test an idleToken by doing a rebalance", async (args: any, hre) => {
    const REBALANCER = addresses.rebalancerManager;
    await hre.network.provider.send("hardhat_impersonateAccount", [REBALANCER])
    let rebalancer = await hre.ethers.getSigner(REBALANCER)

    if (!args.idleToken || !args.allocations || args.allocations.length === 0) {
      console.log('Error missing task args');
      return;
    }
    const accounts = await hre.ethers.getSigners();

    let unlent = args.unlent || 0;
    let account = args.account || accounts[0];
    let whale = args.whale;
    let idleToken = args.idleToken.connect(rebalancer)
    let allocations = args.allocations;

    const waitBlocks = async (n: number) => {
      console.log(`mining ${n} blocks...`);
      for (var i = 0; i < n; i++) {
        await hre.ethers.provider.send("evm_mine", []);
      };
    }

    const setAllocationsAndRebalance = async (idleToken: Contract, allocations: number[], unlent: number, whale: string) => {
        console.log('#### Testing setAllocations and rebalance');
        const underlying = await idleToken.token();
        const underlyingContract = await hre.ethers.getContractAt("IERC20Detailed", underlying);
        const tokenDecimals = await underlyingContract.decimals();
        const oneToken = toBN(`10`).pow(tokenDecimals);
        console.log(`decimals: ${tokenDecimals}`)
        console.log("total supply", (await idleToken.totalSupply()).toString());

        if (unlent) {
          console.log('whale transfer, balance is', (await underlyingContract.balanceOf(whale)).toString());
          const amount = oneToken.mul(toBN(unlent));
          console.log(`amount: ${amount}`)
          await underlyingContract.transfer(idleToken.address, amount, { from: whale });
          console.log('whale transfer complete');
        }

        console.log('# unlent balance: ', toBN(await underlyingContract.balanceOf(idleToken.address)).div(oneToken).toString());
        const tokens = (await idleToken.getAPRs())["0"];
        console.log("tokens", tokens.join(", "));
        const idleTokenName = await idleToken.name();
        console.log("curr allocations", (await idleToken.getAllocations()).map((x: any) => x.toString()));
        
        let bn_allocations = allocations.map<BigNumber>(toBN);
        console.log("new allocations", bn_allocations.toString());
        const rebalancerAddr = await idleToken.rebalancer();

        await hre.network.provider.send("hardhat_setBalance", [rebalancerAddr, "0xffffffffffffffff"]);
        await hre.network.provider.send("hardhat_impersonateAccount", [rebalancerAddr]);
        const rebalancer = await hre.ethers.getSigner(rebalancerAddr);
        idleToken = idleToken.connect(rebalancer);

        await idleToken.setAllocations(bn_allocations);
        const newAllocations = await idleToken.getAllocations();
        console.log("done setting allocations for", idleTokenName, "-", newAllocations.join(", "));
        console.log("rebalancing");
        const tx = await idleToken.rebalance();
        const receipt = await tx.wait()
        console.log("⛽ rebalancing done GAS SPENT: ", receipt.gasUsed.toString())

        console.log('# unlent balance: ', toBN(await underlyingContract.balanceOf(idleToken.address)).div(oneToken).toString());
        for (var i = 0; i < tokens.length; i++) {
            const token = await hre.ethers.getContractAt("IERC20Detailed", tokens[i]);
            const tokenDecimals = toBN(await token.decimals());
            const toTokenUnit = (v: any) => v.div(toBN("10").pow(tokenDecimals));
            const name = await token.name();
            const balance = toTokenUnit(toBN(await token.balanceOf(idleToken.address)));
            console.log("token balance", name, balance.toString());
        };
    }

    const mintAndRedeem = async (account: any, allocations: any) => {
      console.log('#### Testing mint and redeem for user: ', account.address);
      const underlying = await idleToken.token();
      const underlyingContract = await hre.ethers.getContractAt("IERC20Detailed", underlying);
      const tokenDecimals = await underlyingContract.decimals();
      const oneToken = toBN(`10`).pow(tokenDecimals);

      if (!whale) {
        switch(underlying.toLowerCase()) {
          case addresses.SUSD.live.toLowerCase():
            whale = addresses.SUSDwhale;
            break;
          case addresses.TUSD.live.toLowerCase():
            whale = addresses.TUSDwhale;
            break;
          case addresses.WETH.live.toLowerCase():
            whale = addresses.WETHwhale;
            break;
          case addresses.WBTC.live.toLowerCase():
            whale = addresses.WBTCwhale;
            break;
          case addresses.RAI.live.toLowerCase():
            whale = addresses.RAIwhale;
            break;
          case addresses.FEI.live.toLowerCase():
            whale = addresses.FEIwhale;
            break;
          default:
            whale = addresses.whale;
        }
      }
      const whaleSigner = await hre.ethers.getSigner(whale);
      await hre.ethers.provider.send("hardhat_setBalance", [whale, "0xffffffffffffffff"])
      await hre.network.provider.request({
        method: "hardhat_impersonateAccount",
        params: [whale],
      });

      const amount = oneToken.mul(toBN("100"));
      await underlyingContract.connect(whaleSigner).transfer(account.address, amount);
      await underlyingContract.connect(account).approve(idleToken.address, amount);
      await idleToken.connect(account).mintIdleToken(amount, true, addresses.addr0);

      const govTokens = args.govTokens || [];
      const govTokensBalances: any = {};
      for (let i = 0; i < govTokens.length; i++) {
        const address = govTokens[i];
        const token = await hre.ethers.getContractAt(ERC20_ABI, address)
        govTokensBalances[address] = {
          token: token,
          tokenName: await token.name(),
          balanceBefore: await token.balanceOf(account.address),
          balanceContractBefore: await token.balanceOf(idleToken.address),
        }
      }

      await waitBlocks(1000);
      // poke
      // await setAllocationsAndRebalance(idleToken, allocations, 0, '');

      const balance = await idleToken.balanceOf(account.address);
      await idleToken.connect(account).redeemIdleToken(balance);
      for (const address in govTokensBalances) {
        const data = govTokensBalances[address];
        const balanceAfter = await data.token.balanceOf(account.address);
        const balanceContractAfter = await data.token.balanceOf(idleToken.address);

        if (balanceAfter.gt(data.balanceBefore)) {
          console.log(`✅ gov token ${data.tokenName} balance increased correctly (${data.balanceBefore} -> ${balanceAfter}, contractBal ${data.balanceContractBefore} -> ${balanceContractAfter})`);
        } else {
          console.log(`🚨🚨 ERROR!!! gov token ${data.tokenName} balance didn't increase (${data.balanceBefore} -> ${balanceAfter}, contractBal ${data.balanceContractBefore} -> ${balanceContractAfter})`);
        }
      }
    }

    if (!args.isSafe) {
      const govTokens = await idleToken.getGovTokens();
      console.log(`Gov Tokens (${govTokens.length}): `);
      for (let i = 0; i < govTokens.length; i++) {
        const govToken = await hre.ethers.getContractAt("IERC20Detailed", govTokens[i]);
        console.log("- ", await govToken.name(), govToken.address);
      }
    }

    await setAllocationsAndRebalance(idleToken, allocations, unlent, whale);
    await mintAndRedeem(account, allocations);
})
