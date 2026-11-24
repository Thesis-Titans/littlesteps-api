import type { CatalogActivity } from "../types.js";

const ACTIVITY_LIMITATIONS =
  "Educational play prompt only; not a clinical or diagnostic tool.";

export const SYNTHETIC_ACTIVITIES: CatalogActivity[] = [
  {
    id: "act-001",
    title: "Tummy Time Mirror Play",
    type: "activity",
    language: "fil",
    setting: "indoor",
    ageBand: "0-5m",
    domain: "motor",
    durationMinutes: 10,
    durationEstimate: "5-10 mins",
    materials: ["unbreakable mirror", "soft blanket"],
    instructions: [
      "Place baby gently on their tummy on a firm blanket.",
      "Position an unbreakable mirror in their direct line of sight.",
      "Gently talk or sing to encourage lifting their head to see their reflection."
    ],
    provenanceSource: "ECCD Council NELC LRP 3 (2015), PDF p. 106",
    status: "synthetic_fixture",
    limitations: ACTIVITY_LIMITATIONS
  },
  {
    id: "act-002",
    title: "Pen-pen de Sarapen Rhythm Clap",
    type: "rhyme",
    language: "fil",
    setting: "either",
    ageBand: "6-11m",
    domain: "language",
    durationMinutes: 5,
    durationEstimate: "5 mins",
    materials: ["none"],
    instructions: [
      "Sit face-to-face with the infant on your lap.",
      "Clap hands gently in cadence to the traditional rhyme Pen-pen de Sarapen.",
      "Gently tap baby's palms together during the chorus to encourage clapping reflex."
    ],
    provenanceSource:
      "Philippine Traditional Rhyme; ECCD Council NELF (2010), Annex 4, p. 76",
    status: "synthetic_fixture",
    limitations: ACTIVITY_LIMITATIONS
  },
  {
    id: "act-003",
    title: "Cushion Mountain Crawl",
    type: "activity",
    language: "en",
    setting: "indoor",
    ageBand: "12-23m",
    domain: "motor",
    durationMinutes: 15,
    durationEstimate: "10-15 mins",
    materials: ["couch cushions", "pillows"],
    instructions: [
      "Arrange 2 to 3 floor pillows or cushions on a carpeted floor.",
      "Encourage the toddler to crawl over the gentle incline toward a favorite toy.",
      "Stay close to spot and praise balance and spatial coordination."
    ],
    provenanceSource: "ECCD Council NELF (2010), Annex 4 (13–24 months), p. 78",
    status: "synthetic_fixture",
    limitations: ACTIVITY_LIMITATIONS
  },
  {
    id: "act-004",
    title: "Bahay-Bahayan Household Role Play",
    type: "game",
    language: "fil",
    setting: "indoor",
    ageBand: "24-35m",
    domain: "socioEmotional",
    durationMinutes: 20,
    durationEstimate: "15-20 mins",
    materials: ["blanket", "plastic bowls", "wooden spoons"],
    instructions: [
      "Drape a sheet or blanket across two sturdy chairs to build a play house.",
      "Provide clean plastic bowls and spoons for pretend meal preparation.",
      "Join the pretend play, asking questions like 'Ano ang niluluto natin ngayon?'"
    ],
    provenanceSource:
      "Philippine Traditional Play; ECCD Council NELF (2010), Annex 4 (25–36 months), p. 87",
    status: "synthetic_fixture",
    limitations: ACTIVITY_LIMITATIONS
  },
  {
    id: "act-005",
    title: "Household Sorting Challenge",
    type: "activity",
    language: "en",
    setting: "indoor",
    ageBand: "36-47m",
    domain: "cognitive",
    durationMinutes: 15,
    durationEstimate: "10-15 mins",
    materials: ["clean plastic containers", "colored socks or large buttons"],
    instructions: [
      "Set out two containers labeled with colors (e.g., white socks vs colored socks).",
      "Demonstrate placing one item in each container.",
      "Invite the child to sort the remaining pile by color or size."
    ],
    provenanceSource:
      "ECCD Council NELF (2010), Annex 4 (Cognitive Concept Formation), p. 90",
    status: "synthetic_fixture",
    limitations: ACTIVITY_LIMITATIONS
  },
  {
    id: "act-006",
    title: "Si Pilimon Folk Tale & Movement",
    type: "story",
    language: "hil",
    setting: "either",
    ageBand: "48-59m",
    domain: "language",
    durationMinutes: 10,
    durationEstimate: "10 mins",
    materials: ["none"],
    instructions: [
      "Sing or narrate the traditional story of Si Pilimon, nagpanagat sa kadagatan.",
      "Imitate fishing and rowing movements together.",
      "Discuss what kinds of fish live in Philippine waters."
    ],
    provenanceSource:
      "Hiligaynon Traditional Folk Song; ECCD Council NELF (2010), Annex 4, p. 97",
    status: "synthetic_fixture",
    limitations: ACTIVITY_LIMITATIONS
  },
  {
    id: "act-007",
    title: "Piko Hopscotch Coordination",
    type: "game",
    language: "fil",
    setting: "outdoor",
    ageBand: "60-71m",
    domain: "motor",
    durationMinutes: 20,
    durationEstimate: "15-20 mins",
    materials: ["sidewalk chalk", "flat stone or beanbag"],
    instructions: [
      "Draw a simplified 6-square hopscotch (Piko) layout on a safe outdoor pavement.",
      "Have the child toss the beanbag into square 1 and hop over it on one foot.",
      "Turn around at the end and hop back, picking up the marker on the return."
    ],
    provenanceSource:
      "Philippine Traditional Game; ECCD Council NELF (2010), Annex 4, p. 95",
    status: "synthetic_fixture",
    limitations: ACTIVITY_LIMITATIONS
  },
  {
    id: "act-008",
    title: "Stack the Plastic Cups",
    type: "activity",
    language: "en",
    setting: "indoor",
    ageBand: "12-23m",
    domain: "cognitive",
    durationMinutes: 10,
    durationEstimate: "10 mins",
    materials: ["plastic cups", "wooden spoons"],
    instructions: [
      "Set two or three sturdy plastic cups on the floor.",
      "Show how one cup nests inside another or stacks on top.",
      "Let your toddler explore knocking the tower down and rebuilding."
    ],
    provenanceSource: "ECCD Council NELC LRP 3 (2015), PDF p. 162",
    status: "synthetic_fixture",
    limitations: ACTIVITY_LIMITATIONS
  },
  {
    id: "act-009",
    title: "Naming Familiar Objects",
    type: "game",
    language: "en",
    setting: "either",
    ageBand: "12-23m",
    domain: "language",
    durationMinutes: 10,
    durationEstimate: "10 mins",
    materials: ["household toys", "spoon", "cup"],
    instructions: [
      "Gather three familiar everyday items like a toy animal, cup, and spoon.",
      "Point to each item, name it clearly, and pause for toddler's reaction.",
      "Ask 'Where is the cup?' and celebrate whichever way they reach or point."
    ],
    provenanceSource:
      "ECCD Council NELF (2010), Annex 4 (Receptive Language), p. 81",
    status: "synthetic_fixture",
    limitations: ACTIVITY_LIMITATIONS
  },
  {
    id: "act-010",
    title: "Water Splash Basin",
    type: "activity",
    language: "en",
    setting: "indoor",
    ageBand: "12-23m",
    domain: "socioEmotional",
    durationMinutes: 15,
    durationEstimate: "10-15 mins",
    materials: ["water basin", "plastic cups", "sponge"],
    instructions: [
      "Place a shallow basin of warm water on a towel on the floor.",
      "Provide clean plastic cups and a clean sponge for dipping and squeezing.",
      "Stay right beside your toddler with active supervision as they splash."
    ],
    provenanceSource:
      "ECCD Council NELC LRP 3 (2015), Toddler Calendar (1–2 years)",
    status: "synthetic_fixture",
    limitations: ACTIVITY_LIMITATIONS
  },
  {
    id: "act-011",
    title: "Gentle Rattle Tracking",
    type: "game",
    language: "en",
    setting: "indoor",
    ageBand: "0-5m",
    domain: "cognitive",
    durationMinutes: 10,
    durationEstimate: "5-10 mins",
    materials: ["soft rattle"],
    instructions: [
      "Hold a colorful, soft rattle about ten inches from baby's eyes.",
      "Move it slowly from side to side in an arc.",
      "Pause when baby follows the sound and movement with their eyes."
    ],
    provenanceSource: "ECCD Council NELF (2010), Annex 4 (0–6 months), p. 73",
    status: "synthetic_fixture",
    limitations: ACTIVITY_LIMITATIONS
  },
  {
    id: "act-012",
    title: "Peekaboo Behind the Cloth",
    type: "game",
    language: "en",
    setting: "either",
    ageBand: "6-11m",
    domain: "socioEmotional",
    durationMinutes: 10,
    durationEstimate: "5-10 mins",
    materials: ["lightweight cotton cloth"],
    instructions: [
      "Hold a lightweight cloth in front of your face with a warm smile.",
      "Lower the cloth and say 'peekaboo!' with an upbeat, joyful voice.",
      "Let baby pull down the cloth when they reach forward."
    ],
    provenanceSource: "ECCD Council NELF (2010), Annex 4 (7–12 months), p. 78",
    status: "synthetic_fixture",
    limitations: ACTIVITY_LIMITATIONS
  },
  {
    id: "act-013",
    title: "Nature Color Hunt",
    type: "activity",
    language: "en",
    setting: "outdoor",
    ageBand: "24-35m",
    domain: "cognitive",
    durationMinutes: 20,
    durationEstimate: "15-20 mins",
    materials: ["small basket or bucket"],
    instructions: [
      "Take a small bucket outside for a short backyard stroll.",
      "Look together for green leaves, gray stones, or yellow flowers.",
      "Place one of each in the bucket and describe how they look and feel."
    ],
    provenanceSource: "ECCD Council NELF (2010), Annex 4 (Color Grouping), p. 90",
    status: "synthetic_fixture",
    limitations: ACTIVITY_LIMITATIONS
  },
  {
    id: "act-014",
    title: "Cardboard Box Tunnel",
    type: "activity",
    language: "en",
    setting: "indoor",
    ageBand: "24-35m",
    domain: "motor",
    durationMinutes: 20,
    durationEstimate: "15-20 mins",
    materials: ["large cardboard box", "soft blanket"],
    instructions: [
      "Open both ends of a clean delivery box to create a mini crawl tunnel.",
      "Place a soft blanket inside or at the exit on a carpeted floor.",
      "Call your toddler's name from the other side and cheer as they crawl through."
    ],
    provenanceSource:
      "ECCD Council NELF (2010), Annex 4 (25–36 months Gross Motor), p. 87",
    status: "synthetic_fixture",
    limitations: ACTIVITY_LIMITATIONS
  }
];
