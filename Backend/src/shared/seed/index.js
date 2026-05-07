/**
 * Seed script — populates the DB with the catalog data needed to boot SkillForge.
 * Idempotent: if data already exists it skips.
 *
 * Run: `npm run seed`  (or it auto-runs on first server start).
 */
import 'dotenv/config';
import { fileURLToPath } from 'node:url';

import { db } from '../db.js';
import { logger } from '../logger.js';
import { BACKEND_PROBLEMS } from './backend.js';
import { FRONTEND_PROBLEMS } from './frontend.js';
import { SQL_PROBLEMS } from './sql.js';

const CATEGORIES = [
  { slug: 'arrays', name: 'Arrays & Hashing', description: 'Master array manipulation and hash maps', icon: 'Layers', color: 'indigo' },
  { slug: 'strings', name: 'Strings', description: 'String parsing, search and pattern matching', icon: 'Type', color: 'amber' },
  { slug: 'two-pointers', name: 'Two Pointers', description: 'Solve in linear time with paired indices', icon: 'ArrowRightLeft', color: 'sky' },
  { slug: 'sliding-window', name: 'Sliding Window', description: 'Optimal subarray and substring problems', icon: 'Move', color: 'emerald' },
  { slug: 'binary-search', name: 'Binary Search', description: 'Logarithmic search techniques', icon: 'Search', color: 'violet' },
  { slug: 'stack', name: 'Stack', description: 'LIFO data structures', icon: 'Layers3', color: 'rose' },
  { slug: 'linked-list', name: 'Linked List', description: 'Pointer-based sequential data', icon: 'Link', color: 'orange' },
  { slug: 'trees', name: 'Trees', description: 'Binary trees and traversal', icon: 'GitBranch', color: 'teal' },
  { slug: 'graphs', name: 'Graphs', description: 'BFS, DFS and shortest paths', icon: 'Network', color: 'pink' },
  { slug: 'dp', name: 'Dynamic Programming', description: 'Memoization and bottom-up patterns', icon: 'Cpu', color: 'fuchsia' },
  { slug: 'greedy', name: 'Greedy', description: 'Locally optimal choices', icon: 'TrendingUp', color: 'lime' },
  { slug: 'sql', name: 'SQL', description: 'Database querying and joins', icon: 'Database', color: 'cyan' },
  { slug: 'backend', name: 'Backend', description: 'HTTP, parsing, validation and API helpers', icon: 'Server', color: 'blue' },
  { slug: 'frontend', name: 'Frontend', description: 'Formatters, trees and UI helpers', icon: 'LayoutDashboard', color: 'purple' },
];

const PROBLEMS = [
  {
    slug: 'two-sum', title: 'Two Sum', difficulty: 'EASY', category: 'arrays',
    tags: 'array,hash table',
    description: `Given an array of integers \`nums\` and an integer \`target\`, return *indices of the two numbers such that they add up to \`target\`*.

You may assume that each input would have **exactly one solution**, and you may not use the *same* element twice.

You can return the answer in any order.`,
    examples: [
      { input: 'nums = [2,7,11,15], target = 9', output: '[0,1]', explanation: 'Because nums[0] + nums[1] == 9, we return [0, 1].' },
      { input: 'nums = [3,2,4], target = 6', output: '[1,2]' },
      { input: 'nums = [3,3], target = 6', output: '[0,1]' },
    ],
    constraints: '• 2 ≤ nums.length ≤ 10⁴\n• -10⁹ ≤ nums[i] ≤ 10⁹\n• -10⁹ ≤ target ≤ 10⁹\n• Only one valid answer exists.',
    hints: ['A really brute force way would be to search for all possible pairs.', 'Try a one-pass hash table for O(n) time.'],
    starterCode: {
      javascript: `/**\n * @param {number[]} nums\n * @param {number} target\n * @return {number[]}\n */\nvar twoSum = function(nums, target) {\n    \n};`,
      python: `class Solution:\n    def twoSum(self, nums: list[int], target: int) -> list[int]:\n        pass`,
      java: `class Solution {\n    public int[] twoSum(int[] nums, int target) {\n        \n    }\n}`,
      typescript: `function twoSum(nums: number[], target: number): number[] {\n    \n}`,
    },
    expectedOutput: 'twoSum hash map indices target return',
  },
  {
    slug: 'valid-anagram', title: 'Valid Anagram', difficulty: 'EASY', category: 'strings',
    tags: 'hash table,sorting,string',
    description: `Given two strings \`s\` and \`t\`, return \`true\` if \`t\` is an anagram of \`s\`, and \`false\` otherwise.`,
    examples: [
      { input: 's = "anagram", t = "nagaram"', output: 'true' },
      { input: 's = "rat", t = "car"', output: 'false' },
    ],
    constraints: '• 1 ≤ s.length, t.length ≤ 5 * 10⁴\n• s and t consist of lowercase English letters.',
    hints: ['Count frequencies of each character.'],
    starterCode: {
      javascript: `var isAnagram = function(s, t) {\n    \n};`,
      python: `class Solution:\n    def isAnagram(self, s: str, t: str) -> bool:\n        pass`,
    },
    expectedOutput: 'isAnagram count length sorted return',
  },
  {
    slug: 'contains-duplicate', title: 'Contains Duplicate', difficulty: 'EASY', category: 'arrays',
    tags: 'array,hash table',
    description: 'Given an integer array `nums`, return `true` if any value appears at least twice in the array, and return `false` if every element is distinct.',
    examples: [
      { input: 'nums = [1,2,3,1]', output: 'true' },
      { input: 'nums = [1,2,3,4]', output: 'false' },
    ],
    constraints: '• 1 ≤ nums.length ≤ 10⁵\n• -10⁹ ≤ nums[i] ≤ 10⁹',
    hints: ['Sort then look for adjacent equal values, or use a Set.'],
    starterCode: {
      javascript: `var containsDuplicate = function(nums) {\n    \n};`,
      python: `class Solution:\n    def containsDuplicate(self, nums: list[int]) -> bool:\n        pass`,
    },
    expectedOutput: 'containsDuplicate set return true',
  },
  {
    slug: 'best-time-to-buy-sell-stock', title: 'Best Time to Buy and Sell Stock', difficulty: 'EASY', category: 'arrays',
    tags: 'array,dynamic programming',
    description: 'You are given an array `prices` where `prices[i]` is the price of a given stock on the *i-th* day. You want to maximize your profit by choosing a single day to buy one stock and a different day in the future to sell. Return the maximum profit. If no profit, return 0.',
    examples: [
      { input: 'prices = [7,1,5,3,6,4]', output: '5', explanation: 'Buy on day 2 (price = 1), sell on day 5 (price = 6). Profit = 6-1 = 5.' },
      { input: 'prices = [7,6,4,3,1]', output: '0' },
    ],
    constraints: '• 1 ≤ prices.length ≤ 10⁵\n• 0 ≤ prices[i] ≤ 10⁴',
    hints: ['Track the minimum price seen so far while iterating.'],
    starterCode: {
      javascript: `var maxProfit = function(prices) {\n    \n};`,
      python: `class Solution:\n    def maxProfit(self, prices: list[int]) -> int:\n        pass`,
    },
    expectedOutput: 'maxProfit min profit price return',
  },
  {
    slug: 'valid-parentheses', title: 'Valid Parentheses', difficulty: 'EASY', category: 'stack',
    tags: 'string,stack',
    description: 'Given a string `s` containing just the characters `(`, `)`, `{`, `}`, `[` and `]`, determine if the input string is valid. An input is valid when open brackets are closed by the same type of brackets in the correct order.',
    examples: [
      { input: 's = "()"', output: 'true' },
      { input: 's = "()[]{}"', output: 'true' },
      { input: 's = "(]"', output: 'false' },
    ],
    constraints: '• 1 ≤ s.length ≤ 10⁴\n• s consists of parentheses only.',
    hints: ['Use a stack: push openers, pop and compare on closers.'],
    starterCode: {
      javascript: `var isValid = function(s) {\n    \n};`,
      python: `class Solution:\n    def isValid(self, s: str) -> bool:\n        pass`,
    },
    expectedOutput: 'isValid stack push pop bracket return',
  },
  {
    slug: 'merge-two-sorted-lists', title: 'Merge Two Sorted Lists', difficulty: 'EASY', category: 'linked-list',
    tags: 'linked list,recursion',
    description: 'You are given the heads of two sorted linked lists `list1` and `list2`. Merge the two lists into one sorted list. The list should be made by splicing together the nodes of the first two lists. Return the head of the merged linked list.',
    examples: [{ input: 'list1 = [1,2,4], list2 = [1,3,4]', output: '[1,1,2,3,4,4]' }],
    constraints: '• Number of nodes in both lists is in the range [0, 50].\n• -100 ≤ Node.val ≤ 100',
    hints: ['Use a dummy head and walk both lists with two pointers.'],
    starterCode: {
      javascript: `var mergeTwoLists = function(list1, list2) {\n    \n};`,
      python: `class Solution:\n    def mergeTwoLists(self, list1, list2):\n        pass`,
    },
    expectedOutput: 'mergeTwoLists dummy next return list',
  },

  /* MEDIUM */
  {
    slug: 'group-anagrams', title: 'Group Anagrams', difficulty: 'MEDIUM', category: 'strings',
    tags: 'array,hash table,string,sorting',
    description: 'Given an array of strings `strs`, group the anagrams together. You can return the answer in any order.',
    examples: [{ input: 'strs = ["eat","tea","tan","ate","nat","bat"]', output: '[["bat"],["nat","tan"],["ate","eat","tea"]]' }],
    constraints: '• 1 ≤ strs.length ≤ 10⁴\n• 0 ≤ strs[i].length ≤ 100',
    hints: ['Use sorted strings as keys in a hash map.'],
    starterCode: {
      javascript: `var groupAnagrams = function(strs) {\n    \n};`,
      python: `class Solution:\n    def groupAnagrams(self, strs: list[str]) -> list[list[str]]:\n        pass`,
    },
    expectedOutput: 'groupAnagrams hash map sorted key return',
  },
  {
    slug: 'top-k-frequent-elements', title: 'Top K Frequent Elements', difficulty: 'MEDIUM', category: 'arrays',
    tags: 'array,hash table,heap',
    description: 'Given an integer array `nums` and an integer `k`, return *the* `k` *most frequent elements*. You may return the answer in any order.',
    examples: [{ input: 'nums = [1,1,1,2,2,3], k = 2', output: '[1,2]' }],
    constraints: '• 1 ≤ nums.length ≤ 10⁵\n• -10⁴ ≤ nums[i] ≤ 10⁴\n• 1 ≤ k ≤ number of unique elements',
    hints: ['Bucket sort by frequency to achieve O(n) time.'],
    starterCode: {
      javascript: `var topKFrequent = function(nums, k) {\n    \n};`,
      python: `class Solution:\n    def topKFrequent(self, nums: list[int], k: int) -> list[int]:\n        pass`,
    },
    expectedOutput: 'topKFrequent count bucket map return',
  },
  {
    slug: 'product-of-array-except-self', title: 'Product of Array Except Self', difficulty: 'MEDIUM', category: 'arrays',
    tags: 'array,prefix sum',
    description: 'Given an integer array `nums`, return an array `answer` such that `answer[i]` is equal to the product of all the elements of `nums` except `nums[i]`. You must write an algorithm that runs in O(n) time and **without using the division operation**.',
    examples: [{ input: 'nums = [1,2,3,4]', output: '[24,12,8,6]' }],
    constraints: '• 2 ≤ nums.length ≤ 10⁵\n• -30 ≤ nums[i] ≤ 30',
    hints: ['Compute prefix and suffix products in two passes.'],
    starterCode: {
      javascript: `var productExceptSelf = function(nums) {\n    \n};`,
      python: `class Solution:\n    def productExceptSelf(self, nums: list[int]) -> list[int]:\n        pass`,
    },
    expectedOutput: 'productExceptSelf prefix suffix return product',
  },
  {
    slug: 'longest-substring-without-repeating-characters', title: 'Longest Substring Without Repeating Characters', difficulty: 'MEDIUM', category: 'sliding-window',
    tags: 'hash table,string,sliding window',
    description: 'Given a string `s`, find the length of the longest *substring* without repeating characters.',
    examples: [
      { input: 's = "abcabcbb"', output: '3', explanation: 'The answer is "abc", with length 3.' },
      { input: 's = "bbbbb"', output: '1' },
    ],
    constraints: '• 0 ≤ s.length ≤ 5 * 10⁴\n• s consists of English letters, digits, symbols and spaces.',
    hints: ['Slide a window with a hash set of seen characters.'],
    starterCode: {
      javascript: `var lengthOfLongestSubstring = function(s) {\n    \n};`,
      python: `class Solution:\n    def lengthOfLongestSubstring(self, s: str) -> int:\n        pass`,
    },
    expectedOutput: 'lengthOfLongestSubstring window set max length',
  },
  {
    slug: '3sum', title: '3Sum', difficulty: 'MEDIUM', category: 'two-pointers',
    tags: 'array,two pointers,sorting',
    description: 'Given an integer array `nums`, return all the triplets `[nums[i], nums[j], nums[k]]` such that `i != j`, `i != k`, and `j != k`, and `nums[i] + nums[j] + nums[k] == 0`. The solution set must not contain duplicate triplets.',
    examples: [{ input: 'nums = [-1,0,1,2,-1,-4]', output: '[[-1,-1,2],[-1,0,1]]' }],
    constraints: '• 3 ≤ nums.length ≤ 3000\n• -10⁵ ≤ nums[i] ≤ 10⁵',
    hints: ['Sort, fix one pointer, two-pointer sweep.'],
    starterCode: {
      javascript: `var threeSum = function(nums) {\n    \n};`,
      python: `class Solution:\n    def threeSum(self, nums: list[int]) -> list[list[int]]:\n        pass`,
    },
    expectedOutput: 'threeSum sort two pointer triplet return',
  },
  {
    slug: 'binary-search', title: 'Binary Search', difficulty: 'EASY', category: 'binary-search',
    tags: 'array,binary search',
    description: 'Given an array of integers `nums` which is sorted in ascending order, and an integer `target`, write a function to search `target` in `nums`. If it exists return its index, otherwise return `-1`. Must run in O(log n).',
    examples: [
      { input: 'nums = [-1,0,3,5,9,12], target = 9', output: '4' },
      { input: 'nums = [-1,0,3,5,9,12], target = 2', output: '-1' },
    ],
    constraints: '• 1 ≤ nums.length ≤ 10⁴',
    hints: ['Maintain low/high pointers and bisect.'],
    starterCode: {
      javascript: `var search = function(nums, target) {\n    \n};`,
      python: `class Solution:\n    def search(self, nums: list[int], target: int) -> int:\n        pass`,
    },
    expectedOutput: 'search low high mid binary return target',
  },
  {
    slug: 'reverse-linked-list', title: 'Reverse Linked List', difficulty: 'EASY', category: 'linked-list',
    tags: 'linked list,recursion',
    description: 'Given the `head` of a singly linked list, reverse the list, and return the *reversed list*.',
    examples: [{ input: 'head = [1,2,3,4,5]', output: '[5,4,3,2,1]' }],
    constraints: '• 0 ≤ Number of nodes ≤ 5000',
    hints: ['Iterative: keep prev, curr, next.'],
    starterCode: {
      javascript: `var reverseList = function(head) {\n    \n};`,
      python: `class Solution:\n    def reverseList(self, head):\n        pass`,
    },
    expectedOutput: 'reverseList prev curr next return',
  },
  {
    slug: 'invert-binary-tree', title: 'Invert Binary Tree', difficulty: 'EASY', category: 'trees',
    tags: 'tree,depth-first search,binary tree',
    description: 'Given the `root` of a binary tree, invert the tree, and return *its root*.',
    examples: [{ input: 'root = [4,2,7,1,3,6,9]', output: '[4,7,2,9,6,3,1]' }],
    constraints: '• 0 ≤ Nodes ≤ 100\n• -100 ≤ Node.val ≤ 100',
    hints: ['Swap children, recurse.'],
    starterCode: {
      javascript: `var invertTree = function(root) {\n    \n};`,
      python: `class Solution:\n    def invertTree(self, root):\n        pass`,
    },
    expectedOutput: 'invertTree root left right swap return',
  },
  {
    slug: 'maximum-depth-of-binary-tree', title: 'Maximum Depth of Binary Tree', difficulty: 'EASY', category: 'trees',
    tags: 'tree,depth-first search,breadth-first search',
    description: 'Given the `root` of a binary tree, return its *maximum depth*. A tree\'s maximum depth is the number of nodes along the longest path from the root node down to the farthest leaf node.',
    examples: [{ input: 'root = [3,9,20,null,null,15,7]', output: '3' }],
    constraints: '• 0 ≤ Nodes ≤ 10⁴',
    hints: ['1 + max(depth(left), depth(right)).'],
    starterCode: {
      javascript: `var maxDepth = function(root) {\n    \n};`,
      python: `class Solution:\n    def maxDepth(self, root) -> int:\n        pass`,
    },
    expectedOutput: 'maxDepth root left right return max',
  },
  {
    slug: 'number-of-islands', title: 'Number of Islands', difficulty: 'MEDIUM', category: 'graphs',
    tags: 'array,depth-first search,breadth-first search,union find,matrix',
    description: 'Given an `m x n` 2D binary grid `grid` which represents a map of `1`s (land) and `0`s (water), return *the number of islands*. An island is surrounded by water and is formed by connecting adjacent lands horizontally or vertically.',
    examples: [{ input: '[["1","1","0"],["1","0","0"],["0","0","1"]]', output: '2' }],
    constraints: '• 1 ≤ m, n ≤ 300',
    hints: ['DFS/BFS each unvisited land cell and mark connected cells.'],
    starterCode: {
      javascript: `var numIslands = function(grid) {\n    \n};`,
      python: `class Solution:\n    def numIslands(self, grid: list[list[str]]) -> int:\n        pass`,
    },
    expectedOutput: 'numIslands dfs visited grid return count',
  },
  {
    slug: 'climbing-stairs', title: 'Climbing Stairs', difficulty: 'EASY', category: 'dp',
    tags: 'math,dynamic programming,memoization',
    description: 'You are climbing a staircase. It takes `n` steps to reach the top. Each time you can either climb `1` or `2` steps. In how many distinct ways can you climb to the top?',
    examples: [
      { input: 'n = 2', output: '2' },
      { input: 'n = 3', output: '3' },
    ],
    constraints: '• 1 ≤ n ≤ 45',
    hints: ['Fibonacci sequence — f(n) = f(n-1) + f(n-2).'],
    starterCode: {
      javascript: `var climbStairs = function(n) {\n    \n};`,
      python: `class Solution:\n    def climbStairs(self, n: int) -> int:\n        pass`,
    },
    expectedOutput: 'climbStairs dp fib return n',
  },
  {
    slug: 'house-robber', title: 'House Robber', difficulty: 'MEDIUM', category: 'dp',
    tags: 'array,dynamic programming',
    description: 'You are a professional robber planning to rob houses along a street. Each house has a certain amount of money stashed. Adjacent houses have security systems connected, and it will automatically contact the police if two adjacent houses were broken into on the same night. Determine the maximum amount of money you can rob tonight without alerting the police.',
    examples: [
      { input: 'nums = [1,2,3,1]', output: '4' },
      { input: 'nums = [2,7,9,3,1]', output: '12' },
    ],
    constraints: '• 1 ≤ nums.length ≤ 100\n• 0 ≤ nums[i] ≤ 400',
    hints: ['dp[i] = max(dp[i-1], dp[i-2] + nums[i]).'],
    starterCode: {
      javascript: `var rob = function(nums) {\n    \n};`,
      python: `class Solution:\n    def rob(self, nums: list[int]) -> int:\n        pass`,
    },
    expectedOutput: 'rob dp prev max nums return',
  },
  {
    slug: 'jump-game', title: 'Jump Game', difficulty: 'MEDIUM', category: 'greedy',
    tags: 'array,dynamic programming,greedy',
    description: 'You are given an integer array `nums`. You are initially positioned at the array\'s **first index**, and each element in the array represents your maximum jump length at that position. Return `true` if you can reach the last index, or `false` otherwise.',
    examples: [
      { input: 'nums = [2,3,1,1,4]', output: 'true' },
      { input: 'nums = [3,2,1,0,4]', output: 'false' },
    ],
    constraints: '• 1 ≤ nums.length ≤ 10⁴',
    hints: ['Greedy: track furthest reachable index.'],
    starterCode: {
      javascript: `var canJump = function(nums) {\n    \n};`,
      python: `class Solution:\n    def canJump(self, nums: list[int]) -> bool:\n        pass`,
    },
    expectedOutput: 'canJump greedy reach max return',
  },
  {
    slug: 'container-with-most-water', title: 'Container With Most Water', difficulty: 'MEDIUM', category: 'two-pointers',
    tags: 'array,two pointers,greedy',
    description: 'You are given an integer array `height` of length `n`. There are `n` vertical lines drawn such that the two endpoints of the *i*-th line are `(i, 0)` and `(i, height[i])`. Find two lines that together with the x-axis form a container, such that the container contains the most water. Return *the maximum amount of water* a container can store.',
    examples: [{ input: 'height = [1,8,6,2,5,4,8,3,7]', output: '49' }],
    constraints: '• n == height.length\n• 2 ≤ n ≤ 10⁵',
    hints: ['Two pointers from each end; move the shorter one.'],
    starterCode: {
      javascript: `var maxArea = function(height) {\n    \n};`,
      python: `class Solution:\n    def maxArea(self, height: list[int]) -> int:\n        pass`,
    },
    expectedOutput: 'maxArea two pointer height max return',
  },

  /* HARD */
  {
    slug: 'trapping-rain-water', title: 'Trapping Rain Water', difficulty: 'HARD', category: 'two-pointers',
    tags: 'array,two pointers,dynamic programming,stack',
    description: 'Given `n` non-negative integers representing an elevation map where the width of each bar is `1`, compute how much water it can trap after raining.',
    examples: [{ input: 'height = [0,1,0,2,1,0,1,3,2,1,2,1]', output: '6' }],
    constraints: '• n == height.length\n• 1 ≤ n ≤ 2 * 10⁴',
    hints: ['Two-pointer with running max from each side.'],
    starterCode: {
      javascript: `var trap = function(height) {\n    \n};`,
      python: `class Solution:\n    def trap(self, height: list[int]) -> int:\n        pass`,
    },
    expectedOutput: 'trap left right max water return',
  },
  {
    slug: 'median-of-two-sorted-arrays', title: 'Median of Two Sorted Arrays', difficulty: 'HARD', category: 'binary-search',
    tags: 'array,binary search,divide and conquer',
    description: 'Given two sorted arrays `nums1` and `nums2` of size `m` and `n` respectively, return *the median* of the two sorted arrays. The overall run time complexity should be `O(log (m+n))`.',
    examples: [{ input: 'nums1 = [1,3], nums2 = [2]', output: '2.00000' }],
    constraints: '• 0 ≤ m ≤ 1000\n• 0 ≤ n ≤ 1000',
    hints: ['Binary search the smaller array for the partition.'],
    starterCode: {
      javascript: `var findMedianSortedArrays = function(nums1, nums2) {\n    \n};`,
      python: `class Solution:\n    def findMedianSortedArrays(self, nums1: list[int], nums2: list[int]) -> float:\n        pass`,
    },
    expectedOutput: 'findMedianSortedArrays partition binary median return',
  },
  {
    slug: 'longest-consecutive-sequence', title: 'Longest Consecutive Sequence', difficulty: 'MEDIUM', category: 'arrays',
    tags: 'array,hash table,union find',
    description: 'Given an unsorted array of integers `nums`, return the length of the longest consecutive elements sequence. You must write an algorithm that runs in O(n) time.',
    examples: [{ input: 'nums = [100,4,200,1,3,2]', output: '4', explanation: 'The longest consecutive elements sequence is [1,2,3,4]. Therefore its length is 4.' }],
    constraints: '• 0 ≤ nums.length ≤ 10⁵',
    hints: ['For each start (no n-1 in set), expand.'],
    starterCode: {
      javascript: `var longestConsecutive = function(nums) {\n    \n};`,
      python: `class Solution:\n    def longestConsecutive(self, nums: list[int]) -> int:\n        pass`,
    },
    expectedOutput: 'longestConsecutive set start length return',
  },
  {
    slug: 'rotting-oranges', title: 'Rotting Oranges', difficulty: 'MEDIUM', category: 'graphs',
    tags: 'array,breadth-first search,matrix',
    description: 'You are given an `m x n` `grid` where each cell can have one of three values: 0 (empty), 1 (fresh), 2 (rotten). Every minute, any fresh orange that is **4-directionally adjacent** to a rotten orange becomes rotten. Return the minimum number of minutes that must elapse until no cell has a fresh orange. If impossible, return `-1`.',
    examples: [{ input: 'grid = [[2,1,1],[1,1,0],[0,1,1]]', output: '4' }],
    constraints: '• m == grid.length\n• 1 ≤ m, n ≤ 10',
    hints: ['Multi-source BFS from all initially rotten cells.'],
    starterCode: {
      javascript: `var orangesRotting = function(grid) {\n    \n};`,
      python: `class Solution:\n    def orangesRotting(self, grid: list[list[int]]) -> int:\n        pass`,
    },
    expectedOutput: 'orangesRotting bfs queue grid return minutes',
  },
];

const SEEDED_USERNAMES = ['demo', 'tuskmaster', 'codepilot', 'mammoth', 'syntaxer', 'lambda'];
const SEEDED_EMAIL_SUFFIX = '@skillforge.dev';

export function runSeed() {
  const t0 = Date.now();
  const insertCategory = db.prepare(`
    INSERT OR IGNORE INTO categories (slug, name, description, icon, color)
    VALUES (?, ?, ?, ?, ?)
  `);
  const insertProblem = db.prepare(`
    INSERT OR IGNORE INTO problems (
      slug, title, description, difficulty, problem_type, category_id, tags,
      examples_json, constraints, hints_json, starter_code_json, expected_output,
      test_cases_json, sql_setup, function_name,
      total_submissions, accepted_submissions
    )
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  // The original 24 algorithm problems are tagged ALGORITHM; the new
  // backend / frontend / SQL sets each carry their own problem_type.
  const ALL_PROBLEMS = [
    ...PROBLEMS.map(p => ({ ...p, problemType: 'ALGORITHM' })),
    ...BACKEND_PROBLEMS.map(p => ({ ...p, problemType: 'BACKEND' })),
    ...FRONTEND_PROBLEMS.map(p => ({ ...p, problemType: 'FRONTEND' })),
    ...SQL_PROBLEMS.map(p => ({ ...p, problemType: 'SQL' })),
  ];

  db.transaction(() => {
    for (const c of CATEGORIES) {
      insertCategory.run(c.slug, c.name, c.description, c.icon, c.color);
    }
    const catBySlug = Object.fromEntries(db.prepare(`SELECT id, slug FROM categories`).all().map(r => [r.slug, r.id]));
    for (const p of ALL_PROBLEMS) {
      insertProblem.run(
        p.slug, p.title, p.description, p.difficulty, p.problemType,
        catBySlug[p.category] || null, p.tags || '',
        JSON.stringify(p.examples || []), p.constraints || '',
        JSON.stringify(p.hints || []), JSON.stringify(p.starterCode || {}),
        p.expectedOutput || '',
        p.testCases ? JSON.stringify(p.testCases) : null,
        p.sqlSetup || null,
        p.functionName || null,
        0, 0,
      );
    }
  })();

  syncProblemSubmissionStats();

  logger.info(
    {
      durationMs: Date.now() - t0,
      categories: CATEGORIES.length,
      problems: ALL_PROBLEMS.length,
      breakdown: {
        algorithm: PROBLEMS.length,
        backend: BACKEND_PROBLEMS.length,
        frontend: FRONTEND_PROBLEMS.length,
        sql: SQL_PROBLEMS.length,
      },
    },
    'Seed complete',
  );
}

export function syncProblemSubmissionStats() {
  db.exec(`
    UPDATE problems SET
      total_submissions = (
        SELECT COUNT(*) FROM submissions s WHERE s.problem_id = problems.id
      ),
      accepted_submissions = (
        SELECT COUNT(*) FROM submissions s WHERE s.problem_id = problems.id AND s.status = 'ACCEPTED'
      );
  `);
}

export function removeSeededUsers() {
  const placeholders = SEEDED_USERNAMES.map(() => '?').join(', ');
  const rows = db.prepare(`
    SELECT id
    FROM users
    WHERE username IN (${placeholders}) AND lower(email) LIKE ?
  `).all(...SEEDED_USERNAMES, `%${SEEDED_EMAIL_SUFFIX}`);

  if (!rows.length) return 0;

  const deleteUser = db.prepare(`DELETE FROM users WHERE id = ?`);
  db.transaction(() => {
    for (const row of rows) deleteUser.run(row.id);
  })();

  syncProblemSubmissionStats();
  return rows.length;
}

// Allow running as a CLI: `node src/shared/seed/index.js`
if (process.argv[1] && process.argv[1] === fileURLToPath(import.meta.url)) {
  runSeed();
}
