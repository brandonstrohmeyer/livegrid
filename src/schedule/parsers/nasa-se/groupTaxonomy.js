export const nasaSeGroupTaxonomy = {
  canonicalGroups: [
    'Toyota GR',
    'HPDE',
    'HPDE-Intro',
    'HPDE 1',
    'HPDE 2',
    'HPDE 3',
    'HPDE 4',
    'TT Alpha',
    'TT Omega',
    'Thunder Race',
    'Lightning Race',
    'Test/Tune',
    'Comp School',
    'Intro/Toyota',
    'Instructor Clinic'
  ],
  aliasPatterns: [
    { pattern: /all\s*time\s*trial|tt\s*all/i, groups: ['TT Alpha', 'TT Omega'] },
    { pattern: /tt\s*drivers/i, groups: ['TT Alpha', 'TT Omega'] },
    { pattern: /tt\s*practice|warmup|^tt$|tt\s*laps/i, groups: ['TT Alpha', 'TT Omega'] },
    { pattern: /tt\s*group\s*a/i, groups: ['TT Alpha'] },
    { pattern: /tt\s*group\s*b/i, groups: ['TT Omega'] },
    { pattern: /tt\s*alpha|ttu\/a/i, groups: ['TT Alpha'] },
    { pattern: /tt\s*omega|ttu\/b/i, groups: ['TT Omega'] },
    { pattern: /thunder/i, groups: ['Thunder Race'] },
    { pattern: /lightning/i, groups: ['Lightning Race'] },
    { pattern: /mock\s*race/i, groups: ['Test/Tune'] },
    { pattern: /all\s+racers\s+warmup/i, groups: ['Thunder Race', 'Lightning Race'] },
    { pattern: /toyota/i, groups: ['Toyota GR'] },
    { pattern: /hpde[-\s]*intro/i, groups: ['HPDE-Intro'] },
    { pattern: /instructor\s*clinic|^ic$/i, groups: ['Instructor Clinic'] },
    { pattern: /test\s*&\s*tune|test\s*\/\s*tune/i, groups: ['Test/Tune'] }
  ],
  parentGroups: [
    { parent: 'TT', children: ['TT Alpha', 'TT Omega'] },
    { parent: 'Time Trial', children: ['TT Alpha', 'TT Omega'] },
    { parent: 'Race', children: ['Thunder Race', 'Lightning Race'] }
  ],
  expectedRunGroupPatterns: [
    /^Toyota\s*GR$/i,
    /^HPDE\s*\d+$/i,
    /^HPDE-Intro$/i,
    /^HPDE$/i,
    /^TT\s*Alpha$/i,
    /^TT\s*Omega$/i,
    /^Thunder\s*Race$/i,
    /^Lightning\s*Race$/i,
    /^Test\/Tune$/i,
    /^Comp\s*School$/i,
    /^Intro\/Toyota$/i,
    /^Instructor\s*Clinic$/i
  ]
}
