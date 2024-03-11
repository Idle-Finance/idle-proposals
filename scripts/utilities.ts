import { BigNumber } from "ethers";
import { task } from "hardhat/config"

export default task("set-balance-test", "test hardhat_setBalance", async(_, hre) => {
  const WHALE_ADDRESS = '0xe8eA8bAE250028a8709A3841E0Ae1a44820d677b';
  await hre.network.provider.send("hardhat_setBalance", [WHALE_ADDRESS, "0xffffffffffffffff"]);
})
