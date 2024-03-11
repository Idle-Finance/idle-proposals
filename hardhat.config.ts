import { HardhatUserConfig } from "hardhat/config"
import "@nomiclabs/hardhat-waffle"
import "@idle-finance/hardhat-proposals-plugin"

require('dotenv').config()

import "./scripts/iip-11"
import "./scripts/iip-12"
import "./scripts/iip-13"
import "./scripts/iip-14"
import "./scripts/iip-15"
import "./scripts/iip-16"
import "./scripts/iip-17"
import "./scripts/iip-18"
import "./scripts/iip-19"
import "./scripts/iip-20"
import "./scripts/iip-21"
import "./scripts/iip-22"
import "./scripts/iip-24"
import "./scripts/iip-25"
import "./scripts/iip-26"
import "./scripts/iip-27"
import "./scripts/iip-28"
import "./scripts/iip-29"
import "./scripts/iip-30"
import "./scripts/iip-31"
import "./scripts/iip-32"
import "./scripts/iip-33"
import "./scripts/iip-34"
import "./scripts/iip-35"
import "./scripts/iip-36"
import "./scripts/iip-37"
import "./scripts/iip-39"
import "./scripts/iip-upgrade"
import "./scripts/utilities"
import "./scripts/test-idle-token"
import "./scripts/example-upgrade"
import "./scripts/execute-proposal-or-simulate"
import "./scripts/manual-exec-proposal"
import "./scripts/polygon/upgrade-and-call-polygon"
import "./scripts/polygon/transfer-ownership-polygon"

const config: HardhatUserConfig = {
  solidity: {
    compilers: [
      {
        version: "0.5.16",
        settings: {
          optimizer: {
            enabled: true,
            runs: 25
          }
        }
      },
      {
        version: "0.6.12",
        settings: {
          optimizer: {
            enabled: true,
            runs: 200
          }
        }
      },
      {
        version: "0.8.13",
        settings: {
          optimizer: {
            enabled: true,
            runs: 200
          }
        }
      },
    ],
  },
  networks: {
    hardhat: {
      loggingEnabled: true,
      forking: {
        // Ethereum
        // url: `https://mainnet.infura.io/v3/${process.env.INFURA_API_KEY}`,
        url: `https://eth-mainnet.alchemyapi.io/v2/${process.env.ALCHEMY_API_KEY}`,
        blockNumber: 19391610, // iip-39
        // blockNumber: 17634301 // iip-37
        // blockNumber: 17465062 // iip-36
        // blockNumber: 17216816 // iip-35
        // blockNumber: 17088152 // iip-34
        // blockNumber: 17024100 // iip-33
        // blockNumber: 16642112 // iip-32
        // blockNumber: 16468596 // iip-31
        // blockNumber: 16298318 // iip-30
        // blockNumber: 16225115 // iip-29
        // blockNumber: 16017810 // iip-28
        // blockNumber: 15940852 // iip-27
        // blockNumber: 15546754 // iip-26
        // blockNumber: 15483272 // iip-25
        // blockNumber: 15366158 // iip-24
        // blockNumber: 14590776 // iip-22
        // blockNumber: 14526488 // iip-21
        // blockNumber: 14474950 // iip-20
        // blockNumber: 14386195 // iip-19
        // blockNumber: 13753067 // iip-18
        // blockNumber: 13665047, // iip-17
        // blockNumber: 13587540, // iip-16
        // blockNumber: 13543217, // iip-15
        // blockNumber: 13372333, // iip-14
        // blockNumber: 13334600, // iip-13
        // blockNumber: 13235728, // iip-12
        // blockNumber: 12725152, // iip-11

        // Polygon
        // url: `https://polygon-mainnet.g.alchemy.com/v2/${process.env.ALCHEMY_API_KEY}`,
        // url: `https://polygon-mainnet.infura.io/v3/${process.env.INFURA_API_KEY}`,
        // blockNumber: 24236280,
      },
      // timeout: 10000000
      // allowUnlimitedContractSize: true
    },
    mainnet: {
      url: `https://eth-mainnet.alchemyapi.io/v2/${process.env.ALCHEMY_API_KEY}`,
      gasPrice: 'auto',
      gas: 'auto',
      timeout: 1200000
    },
    matic: {
      // url: `https://polygon-mainnet.g.alchemy.com/v2/${process.env.ALCHEMY_API_KEY}`,
      url: `https://polygon-mainnet.infura.io/v3/${process.env.INFURA_API_KEY}`,
      gasPrice: 'auto',
      gas: 'auto',
      timeout: 1200000,
      chainId: 137
    }
  },
  proposals: {
    governor: "0x3D5Fc645320be0A085A32885F078F7121e5E5375",
    votingToken: "0x875773784Af8135eA0ef43b5a374AaD105c5D39e"
  }
}

export default config;
