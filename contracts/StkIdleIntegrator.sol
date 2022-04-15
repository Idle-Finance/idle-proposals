pragma solidity 0.8.13;

import "hardhat/console.sol";
interface StkIDLE {
  function increase_unlock_time(uint256) external;
  function create_lock(uint256, uint256) external;
  function locked(address) external returns (uint256 amount, uint256 end);
}
interface IIDLE {
  function balanceOf(address) external returns (uint256);
  function transfer(address to, uint256 value) external returns (bool);
  function approve(address spender, uint256 value) external returns (bool);
}

contract StkIdleIntegrator {
  address public constant IDLE = 0x875773784Af8135eA0ef43b5a374AaD105c5D39e;
  address public constant stkIDLE = 0xaAC13a116eA7016689993193FcE4BadC8038136f;
  function createLock() public {
    IIDLE idle = IIDLE(IDLE);
    StkIDLE stk = StkIDLE(stkIDLE);
    uint256 bal = idle.balanceOf(address(this));
    idle.approve(address(stk), bal);
    // min should be a week
    stk.create_lock(bal, block.timestamp + 10 days);
  }
}