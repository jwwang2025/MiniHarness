export type Difficulty = 1 | 2 | 3 | 4  | 5;

export type Verification = 
    | { type: "contain"; expected: string; }
    | { type: "regex"; pattern: string; }
    | { type: "script"; command: string; }

export interface EvalTask {
    id: string;
    description: string;
    category: string;
    difficulty: Difficulty;
    verify: Verification;
    setup?:()=>Promise<void>;
    teardown?:()=>Promise<void>;
}

export interface EvalResult {
    taskId: string;
    passed: boolean;
    answer: string;
    rounds: number;
    tokens: number;
    cost: number;
    durationMs: number;
    error?: string;
}

export interface EvalReport {
    results: EvalResult[];
    summary: {
        total: number;
        passed: number;
        passedRate: number;
        avgRounds: number;
        totalTokens: number;
        totalCost: number;
        durationMs: number;
    };
    baseline?:{
        passRate: number;
        regressions: string[];
        improvements: string[];
    };
    createdAt: number;
}
