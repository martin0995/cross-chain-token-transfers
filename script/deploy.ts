import { ethers } from "ethers";
import * as fs from "fs";
import * as path from "path";
import * as dotenv from "dotenv";
import readlineSync from "readline-sync";

dotenv.config();

interface ChainConfig {
  description: string;
  chainId: number;
  rpc: string;
  tokenBridge: string;
  wormholeRelayer: string;
  wormhole: string;
}

interface DeployedContracts {
  [chainId: number]: {
    networkName: string;
    CrossChainSender?: string;
    CrossChainReceiver?: string;
    deployedAt: string;
  };
}

function loadConfig(): ChainConfig[] {
  const configPath = path.resolve(__dirname, "../deploy-config/config.json");
  return JSON.parse(fs.readFileSync(configPath, "utf8")).chains;
}

function selectChain(chains: ChainConfig[], role: "source" | "target"): ChainConfig {
  console.log(`\nSelect the ${role.toUpperCase()} chain:`);
  chains.forEach((chain, index) => {
    console.log(`${index + 1}: ${chain.description}`);
  });

  const chainIndex = readlineSync.questionInt(`\nEnter the number for the ${role.toUpperCase()} chain: `) - 1;
  return chains[chainIndex];
}

async function main() {
  const chains = loadConfig();

  // Let the user select the source and target chains
  const sourceChain = selectChain(chains, "source");
  const targetChain = selectChain(chains, "target");

  const sourceProvider = new ethers.JsonRpcProvider(sourceChain.rpc);
  const targetProvider = new ethers.JsonRpcProvider(targetChain.rpc);
  const wallet = new ethers.Wallet(process.env.PRIVATE_KEY!, sourceProvider);

  const senderJson = JSON.parse(
    fs.readFileSync(
      path.resolve(__dirname, "../out/CrossChainSender.sol/CrossChainSender.json"),
      "utf8"
    )
  );

  const abi = senderJson.abi;
  const bytecode = senderJson.bytecode;

  const CrossChainSenderFactory = new ethers.ContractFactory(abi, bytecode, wallet);

  // Deploy the contract on the source chain
  const senderContract = await CrossChainSenderFactory.deploy(
    sourceChain.wormholeRelayer,
    sourceChain.tokenBridge,
    sourceChain.wormhole
  );
  await senderContract.waitForDeployment();

  // Safely access the deployed contract's address
  const senderAddress = (senderContract as ethers.Contract).target;
  console.log(`CrossChainSender deployed on ${sourceChain.description} at: ${senderAddress}`);

  // Deploy the receiver contract on the target chain
  const targetWallet = new ethers.Wallet(process.env.PRIVATE_KEY!, targetProvider);
  const receiverJson = JSON.parse(
    fs.readFileSync(
      path.resolve(__dirname, "../out/CrossChainReceiver.sol/CrossChainReceiver.json"),
      "utf8"
    )
  );
  const CrossChainReceiverFactory = new ethers.ContractFactory(receiverJson.abi, receiverJson.bytecode, targetWallet);

  const receiverContract = await CrossChainReceiverFactory.deploy(
    targetChain.wormholeRelayer,
    targetChain.tokenBridge,
    targetChain.wormhole
  );
  await receiverContract.waitForDeployment();

  // Safely access the deployed contract's address
  const receiverAddress = (receiverContract as ethers.Contract).target;
  console.log(`CrossChainReceiver deployed on ${targetChain.description} at: ${receiverAddress}`);

  // Store deployed contract addresses in contracts.json
  const deployedContractsPath = path.resolve(__dirname, "../deploy-config/contracts.json");
  let deployedContracts: DeployedContracts = {};

  if (fs.existsSync(deployedContractsPath)) {
    deployedContracts = JSON.parse(fs.readFileSync(deployedContractsPath, "utf8"));
  }

  deployedContracts[sourceChain.chainId] = {
    networkName: sourceChain.description,
    CrossChainSender: senderAddress.toString(),
    deployedAt: new Date().toISOString(),
  };
  deployedContracts[targetChain.chainId] = {
    networkName: targetChain.description,
    CrossChainReceiver: receiverAddress.toString(),
    deployedAt: new Date().toISOString(),
  };

  fs.writeFileSync(deployedContractsPath, JSON.stringify(deployedContracts, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
