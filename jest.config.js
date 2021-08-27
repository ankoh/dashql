export default {
    projects: ['<rootDir>/packages/*'],

    // Coverage output
    coverageDirectory: '<rootDir>/coverage',
    // Collect coverage from these files
    collectCoverageFrom: ['src/**/*.{js,jsx,ts,tsx}', '!src/index.ts'],
};
