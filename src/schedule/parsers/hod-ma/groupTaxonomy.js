export const hodMaGroupTaxonomy = {
  canonicalGroups: ['A - Novice', 'B - Intermediate', 'C - Advanced', 'D - Expert', 'OUT Motorsports', 'P&P'],
  aliasPatterns: [
    { pattern: /\bA1\b/i, groups: ['A - Novice'] },
    { pattern: /\bA\b/i, groups: ['A - Novice'] },
    { pattern: /\bB\b/i, groups: ['B - Intermediate'] },
    { pattern: /\bC\b/i, groups: ['C - Advanced'] },
    { pattern: /\bD\b/i, groups: ['D - Expert'] },
    { pattern: /C\s*\/\s*D/i, groups: ['C - Advanced', 'D - Expert'] },
    { pattern: /A\s*\/\s*B/i, groups: ['A - Novice', 'B - Intermediate'] },
    { pattern: /B\s*\+\s*C\s*\+\s*D/i, groups: ['B - Intermediate', 'C - Advanced', 'D - Expert'] },
    { pattern: /A\s*-?\s*Novice|Group\s*A\s*Classroom|Novice/i, groups: ['A - Novice'] },
    { pattern: /Intermediate/i, groups: ['B - Intermediate'] },
    { pattern: /Advanced/i, groups: ['C - Advanced'] },
    { pattern: /Expert/i, groups: ['D - Expert'] },
    { pattern: /OUT\s*Motorsports/i, groups: ['OUT Motorsports'] },
    { pattern: /P\s*&\s*P|P&P/i, groups: ['P&P'] }
  ],
  expectedRunGroupPatterns: [
    /^A\s*-\s*Novice$/i,
    /^B\s*-\s*Intermediate$/i,
    /^C\s*-\s*Advanced$/i,
    /^D\s*-\s*Expert$/i,
    /^OUT\s*Motorsports$/i,
    /^P&P$/i
  ]
}
