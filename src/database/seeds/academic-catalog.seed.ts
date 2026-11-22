import type { PrismaClient } from '../../generated/prisma/client.js';

const EDUCATION_BOARDS = [
  { code: 'DHAKA', name: 'Dhaka', nameBn: 'ঢাকা' },
  { code: 'RAJSHAHI', name: 'Rajshahi', nameBn: 'রাজশাহী' },
  { code: 'CUMILLA', name: 'Cumilla', nameBn: 'কুমিল্লা' },
  { code: 'JASHORE', name: 'Jashore', nameBn: 'যশোর' },
  { code: 'CHATTOGRAM', name: 'Chattogram', nameBn: 'চট্টগ্রাম' },
  { code: 'BARISHAL', name: 'Barishal', nameBn: 'বরিশাল' },
  { code: 'SYLHET', name: 'Sylhet', nameBn: 'সিলেট' },
  { code: 'DINAJPUR', name: 'Dinajpur', nameBn: 'দিনাজপুর' },
  { code: 'MYMENSINGH', name: 'Mymensingh', nameBn: 'ময়মনসিংহ' },
  { code: 'MADRASAH', name: 'Madrasah', nameBn: 'মাদ্রাসা' },
  { code: 'TECHNICAL', name: 'Technical', nameBn: 'কারিগরি' },
];

const CLASSES = [
  { code: 'CLASS_9', name: 'Class 9', nameBn: 'নবম শ্রেণি', level: 'SSC', sortOrder: 9 },
  { code: 'CLASS_10', name: 'Class 10', nameBn: 'দশম শ্রেণি', level: 'SSC', sortOrder: 10 },
  {
    code: 'HSC_1ST_YEAR',
    name: 'HSC 1st Year',
    nameBn: 'একাদশ শ্রেণি',
    level: 'HSC',
    sortOrder: 11,
  },
  {
    code: 'HSC_2ND_YEAR',
    name: 'HSC 2nd Year',
    nameBn: 'দ্বাদশ শ্রেণি',
    level: 'HSC',
    sortOrder: 12,
  },
] as const;

const GROUPS = [
  { code: 'SCIENCE', name: 'Science', nameBn: 'বিজ্ঞান' },
  { code: 'HUMANITIES', name: 'Humanities', nameBn: 'মানবিক' },
  { code: 'BUSINESS_STUDIES', name: 'Business Studies', nameBn: 'ব্যবসায় শিক্ষা' },
];

/** Idempotent reference data. Subjects/books are imported later from official NCTB data. */
export async function seedAcademicCatalog(prisma: PrismaClient): Promise<void> {
  for (const board of EDUCATION_BOARDS) {
    await prisma.educationBoard.upsert({
      where: { code: board.code },
      update: board,
      create: board,
    });
  }
  for (const academicClass of CLASSES) {
    await prisma.academicClass.upsert({
      where: { code: academicClass.code },
      update: academicClass,
      create: academicClass,
    });
  }
  for (const group of GROUPS) {
    await prisma.group.upsert({ where: { code: group.code }, update: group, create: group });
  }
}
