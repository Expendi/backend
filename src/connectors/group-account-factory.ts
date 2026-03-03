import { expandMultiChain } from "../services/contract/types.js";

const GROUP_ACCOUNT_FACTORY_ABI = [
  {
    type: "function",
    name: "createGroup",
    stateMutability: "nonpayable",
    inputs: [{ name: "members", type: "address[]" }],
    outputs: [{ name: "", type: "address" }],
  },
  {
    type: "function",
    name: "getGroups",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "address[]" }],
  },
  {
    type: "function",
    name: "getGroupCount",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "uint256" }],
  },
  {
    type: "function",
    name: "getUserGroups",
    stateMutability: "view",
    inputs: [{ name: "user", type: "address" }],
    outputs: [{ name: "", type: "address[]" }],
  },
  {
    type: "event",
    name: "GroupCreated",
    inputs: [
      { name: "group", type: "address", indexed: true },
      { name: "admin", type: "address", indexed: true },
    ],
  },
] as const;

const groupAccountFactoryMethods = {
  create: {
    functionName: "createGroup",
    description: "Create a new group account with initial members",
  },
  groups: {
    functionName: "getGroups",
    description: "Get all group addresses created by this factory",
  },
  userGroups: {
    functionName: "getUserGroups",
    description: "Get all group addresses a user belongs to",
  },
  groupCount: {
    functionName: "getGroupCount",
    description: "Get the total number of groups created",
  },
} as const;

// Placeholder address — contracts not deployed yet
export const groupAccountFactoryConnectors = [
  ...expandMultiChain({
    name: "group-account-factory",
    addresses: {
      8453: "0x0000000000000000000000000000000000000000", // Base (placeholder)
    },
    abi: GROUP_ACCOUNT_FACTORY_ABI,
    methods: groupAccountFactoryMethods,
  }),
];
