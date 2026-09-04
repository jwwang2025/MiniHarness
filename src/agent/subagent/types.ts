export interface SubTask {
    id: string;
    title: string;
    description: string;
    dependencies: string[];
    tools?: string[];
}

export interface SubTaskResult {
    taskId: string;
    title: string;
    success: boolean;
    output: string;
    error?: string;
    durationMs: number;
}

export interface DecompositionResult {
    tasks: SubTask[];
    plan: string;
}

export interface SubAgentOptions {
    maxParallel?: number;
    maxRoundsPerTask?: number;
}