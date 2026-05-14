/**
 * STDIO practice problems.
 *
 * Each problem ships stdin/expected_stdout test cases and reference
 * solutions in every language on its `languageAllowlist`. The STDIO
 * judge reads stdin, executes the student program, captures stdout,
 * and compares under the configured `comparatorMode`.
 */

// ---------------------------------------------------------------------------
// Problem 1: stdio-sum-of-n
// ---------------------------------------------------------------------------

const sumOfNReferenceSolutions = {
  JAVASCRIPT: `const lines = require('fs').readFileSync(0, 'utf8').trim().split('\\n');
const n = parseInt(lines[0], 10);
const nums = lines[1].split(' ').map(Number);
let sum = 0;
for (let i = 0; i < n; i++) sum += nums[i];
console.log(sum);
`,
  PYTHON: `import sys

def main():
    data = sys.stdin.read().split()
    n = int(data[0])
    nums = list(map(int, data[1:n+1]))
    print(sum(nums))

main()
`,
  JAVA: `import java.util.Scanner;

public class Main {
    public static void main(String[] args) {
        Scanner sc = new Scanner(System.in);
        int n = sc.nextInt();
        long sum = 0;
        for (int i = 0; i < n; i++) {
            sum += sc.nextLong();
        }
        System.out.println(sum);
    }
}
`,
  GO: `package main

import (
	"bufio"
	"fmt"
	"os"
)

func main() {
	reader := bufio.NewReader(os.Stdin)
	var n int
	fmt.Fscan(reader, &n)
	sum := 0
	for i := 0; i < n; i++ {
		var x int
		fmt.Fscan(reader, &x)
		sum += x
	}
	fmt.Println(sum)
}
`,
  CPP: `#include <iostream>
using namespace std;

int main() {
    int n;
    cin >> n;
    long long sum = 0;
    for (int i = 0; i < n; i++) {
        long long x;
        cin >> x;
        sum += x;
    }
    cout << sum << endl;
    return 0;
}
`,
};

// ---------------------------------------------------------------------------
// Problem 2: stdio-fizzbuzz
// ---------------------------------------------------------------------------

const fizzbuzzReferenceSolutions = {
  JAVASCRIPT: `const n = parseInt(require('fs').readFileSync(0, 'utf8').trim(), 10);
for (let i = 1; i <= n; i++) {
  if (i % 15 === 0) console.log('FizzBuzz');
  else if (i % 3 === 0) console.log('Fizz');
  else if (i % 5 === 0) console.log('Buzz');
  else console.log(i);
}
`,
  PYTHON: `import sys

def main():
    n = int(sys.stdin.readline())
    for i in range(1, n + 1):
        if i % 15 == 0:
            print("FizzBuzz")
        elif i % 3 == 0:
            print("Fizz")
        elif i % 5 == 0:
            print("Buzz")
        else:
            print(i)

main()
`,
  JAVA: `import java.util.Scanner;

public class Main {
    public static void main(String[] args) {
        Scanner sc = new Scanner(System.in);
        int n = sc.nextInt();
        StringBuilder sb = new StringBuilder();
        for (int i = 1; i <= n; i++) {
            if (i % 15 == 0) sb.append("FizzBuzz");
            else if (i % 3 == 0) sb.append("Fizz");
            else if (i % 5 == 0) sb.append("Buzz");
            else sb.append(i);
            sb.append('\\n');
        }
        System.out.print(sb);
    }
}
`,
  GO: `package main

import (
	"bufio"
	"fmt"
	"os"
	"strconv"
)

func main() {
	reader := bufio.NewReader(os.Stdin)
	writer := bufio.NewWriter(os.Stdout)
	defer writer.Flush()

	var n int
	fmt.Fscan(reader, &n)
	for i := 1; i <= n; i++ {
		if i%15 == 0 {
			writer.WriteString("FizzBuzz\n")
		} else if i%3 == 0 {
			writer.WriteString("Fizz\n")
		} else if i%5 == 0 {
			writer.WriteString("Buzz\n")
		} else {
			writer.WriteString(strconv.Itoa(i) + "\n")
		}
	}
}
`,
  CPP: `#include <iostream>
using namespace std;

int main() {
    int n;
    cin >> n;
    for (int i = 1; i <= n; i++) {
        if (i % 15 == 0) cout << "FizzBuzz" << '\\n';
        else if (i % 3 == 0) cout << "Fizz" << '\\n';
        else if (i % 5 == 0) cout << "Buzz" << '\\n';
        else cout << i << '\\n';
    }
    return 0;
}
`,
};

// ---------------------------------------------------------------------------
// Problem 3: stdio-stable-sort-by-key
// ---------------------------------------------------------------------------

const stableSortReferenceSolutions = {
  JAVASCRIPT: `const lines = require('fs').readFileSync(0, 'utf8').trim().split('\\n');
const n = parseInt(lines[0], 10);
const records = [];
for (let i = 1; i <= n; i++) {
  const parts = lines[i].split(' ');
  const key = parseInt(parts[0], 10);
  const value = parts.slice(1).join(' ');
  records.push({ key, value, idx: i });
}
records.sort((a, b) => a.key - b.key);
for (const r of records) {
  console.log(r.key + ' ' + r.value);
}
`,
  PYTHON: `import sys

def main():
    data = sys.stdin.read().strip().split('\\n')
    n = int(data[0])
    records = []
    for i in range(1, n + 1):
        parts = data[i].split(' ', 1)
        key = int(parts[0])
        value = parts[1] if len(parts) > 1 else ''
        records.append((key, value))
    records.sort(key=lambda r: r[0])
    for key, value in records:
        print(f"{key} {value}")

main()
`,
  JAVA: `import java.util.*;
import java.io.*;

public class Main {
    public static void main(String[] args) throws Exception {
        BufferedReader br = new BufferedReader(new InputStreamReader(System.in));
        int n = Integer.parseInt(br.readLine().trim());
        String[][] records = new String[n][2];
        for (int i = 0; i < n; i++) {
            String line = br.readLine();
            int sp = line.indexOf(' ');
            records[i][0] = line.substring(0, sp);
            records[i][1] = line.substring(sp + 1);
        }
        Arrays.sort(records, (a, b) -> Integer.parseInt(a[0]) - Integer.parseInt(b[0]));
        StringBuilder sb = new StringBuilder();
        for (String[] r : records) {
            sb.append(r[0]).append(' ').append(r[1]).append('\\n');
        }
        System.out.print(sb);
    }
}
`,
  GO: `package main

import (
	"bufio"
	"fmt"
	"os"
	"sort"
	"strconv"
	"strings"
)

type record struct {
	key   int
	value string
	idx   int
}

func main() {
	scanner := bufio.NewScanner(os.Stdin)
	scanner.Buffer(make([]byte, 1024*1024), 1024*1024)
	scanner.Scan()
	n, _ := strconv.Atoi(strings.TrimSpace(scanner.Text()))
	records := make([]record, n)
	for i := 0; i < n; i++ {
		scanner.Scan()
		line := scanner.Text()
		sp := strings.IndexByte(line, ' ')
		key, _ := strconv.Atoi(line[:sp])
		records[i] = record{key: key, value: line[sp+1:], idx: i}
	}
	sort.SliceStable(records, func(i, j int) bool {
		return records[i].key < records[j].key
	})
	writer := bufio.NewWriter(os.Stdout)
	defer writer.Flush()
	for _, r := range records {
		fmt.Fprintf(writer, "%d %s\n", r.key, r.value)
	}
}
`,
  CPP: `#include <iostream>
#include <vector>
#include <algorithm>
#include <string>
using namespace std;

int main() {
    ios_base::sync_with_stdio(false);
    cin.tie(nullptr);
    int n;
    cin >> n;
    cin.ignore();
    vector<pair<int, string>> records(n);
    for (int i = 0; i < n; i++) {
        string line;
        getline(cin, line);
        int sp = line.find(' ');
        records[i].first = stoi(line.substr(0, sp));
        records[i].second = line.substr(sp + 1);
    }
    stable_sort(records.begin(), records.end(), [](const auto& a, const auto& b) {
        return a.first < b.first;
    });
    for (const auto& r : records) {
        cout << r.first << ' ' << r.second << '\\n';
    }
    return 0;
}
`,
};

// ---------------------------------------------------------------------------
// Helper: generate FizzBuzz expected output for a given N
// ---------------------------------------------------------------------------
function generateFizzBuzz(n) {
  const lines = [];
  for (let i = 1; i <= n; i++) {
    if (i % 15 === 0) lines.push('FizzBuzz');
    else if (i % 3 === 0) lines.push('Fizz');
    else if (i % 5 === 0) lines.push('Buzz');
    else lines.push(String(i));
  }
  return lines.join('\n') + '\n';
}

// ---------------------------------------------------------------------------
// Exported problems array
// ---------------------------------------------------------------------------

export const stdioProblems = [
  // Problem 1: Sum of N
  {
    slug: 'stdio-sum-of-n',
    title: 'Sum of N Integers',
    description:
`Read an integer **N** on the first line, then read **N** space-separated integers on the second line. Print their sum.

### Input
- Line 1: a single integer N (1 ≤ N ≤ 100000)
- Line 2: N space-separated integers (each between -10⁹ and 10⁹)

### Output
A single integer — the sum of the N numbers.`,
    difficulty: 'EASY',
    problemType: 'STDIO',
    categorySlug: 'algorithms',
    comparatorMode: 'TRIMMED',
    languageAllowlist: ['JAVASCRIPT', 'PYTHON', 'JAVA', 'GO', 'CPP'],
    timeLimitMs: 2000,
    memoryLimitMb: 256,
    outputSizeCapKb: 64,
    testCases: [
      {
        stdin: '5\n1 2 3 4 5\n',
        expected_stdout: '15\n',
        visibility: 'SAMPLE',
      },
      {
        stdin: '1\n42\n',
        expected_stdout: '42\n',
        visibility: 'HIDDEN',
      },
      {
        stdin: '3\n-1 0 1\n',
        expected_stdout: '0\n',
        visibility: 'HIDDEN',
      },
      {
        stdin: '4\n1000000000 1000000000 1000000000 1000000000\n',
        expected_stdout: '4000000000\n',
        visibility: 'HIDDEN',
      },
    ],
    referenceSolutions: sumOfNReferenceSolutions,
  },

  // Problem 2: FizzBuzz
  {
    slug: 'stdio-fizzbuzz',
    title: 'FizzBuzz',
    description:
`Read a single integer **N** and print the FizzBuzz sequence from 1 to N, one value per line.

### Rules
- If the number is divisible by both 3 and 5, print \`FizzBuzz\`.
- If the number is divisible by 3 (but not 5), print \`Fizz\`.
- If the number is divisible by 5 (but not 3), print \`Buzz\`.
- Otherwise, print the number itself.

### Input
A single integer N (1 ≤ N ≤ 100000).

### Output
N lines, each containing the appropriate FizzBuzz value.`,
    difficulty: 'EASY',
    problemType: 'STDIO',
    categorySlug: 'algorithms',
    comparatorMode: 'TRIMMED',
    languageAllowlist: ['JAVASCRIPT', 'PYTHON', 'JAVA', 'GO', 'CPP'],
    timeLimitMs: 2000,
    memoryLimitMb: 256,
    outputSizeCapKb: 64,
    testCases: [
      {
        stdin: '15\n',
        expected_stdout: generateFizzBuzz(15),
        visibility: 'SAMPLE',
      },
      {
        stdin: '1\n',
        expected_stdout: '1\n',
        visibility: 'HIDDEN',
      },
      {
        stdin: '30\n',
        expected_stdout: generateFizzBuzz(30),
        visibility: 'HIDDEN',
      },
    ],
    referenceSolutions: fizzbuzzReferenceSolutions,
  },

  // Problem 3: Stable Sort by Key
  {
    slug: 'stdio-stable-sort-by-key',
    title: 'Stable Sort by Key',
    description:
`Read **N** records, each consisting of an integer key and a string value separated by a space. Sort the records by key in ascending order. If two records have the same key, they must appear in the same order as in the input (stable sort).

### Input
- Line 1: a single integer N (1 ≤ N ≤ 100000)
- Lines 2..N+1: each line contains an integer key followed by a space and a string value

### Output
N lines, each containing the key and value of the sorted records, in the same format as the input.`,
    difficulty: 'MEDIUM',
    problemType: 'STDIO',
    categorySlug: 'algorithms',
    comparatorMode: 'WHITESPACE_NORMALIZED',
    languageAllowlist: ['JAVASCRIPT', 'PYTHON', 'JAVA', 'GO', 'CPP'],
    timeLimitMs: 2000,
    memoryLimitMb: 256,
    outputSizeCapKb: 64,
    testCases: [
      {
        stdin: '5\n3 cherry\n1 apple\n2 banana\n1 avocado\n2 blueberry\n',
        expected_stdout: '1 apple\n1 avocado\n2 banana\n2 blueberry\n3 cherry\n',
        visibility: 'SAMPLE',
      },
      {
        stdin: '10\n5 echo\n3 charlie\n5 foxtrot\n1 alpha\n2 bravo\n3 delta\n4 golf\n1 hotel\n2 india\n4 juliet\n',
        expected_stdout: '1 alpha\n1 hotel\n2 bravo\n2 india\n3 charlie\n3 delta\n4 golf\n4 juliet\n5 echo\n5 foxtrot\n',
        visibility: 'HIDDEN',
      },
      {
        stdin: '8\n100 z\n1 a\n50 m\n1 b\n100 y\n50 n\n1 c\n100 x\n',
        expected_stdout: '1 a\n1 b\n1 c\n50 m\n50 n\n100 z\n100 y\n100 x\n',
        visibility: 'HIDDEN',
      },
    ],
    referenceSolutions: stableSortReferenceSolutions,
  },
];
