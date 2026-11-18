/**
 * Loopback Host / Origin validation for the local OpenAI shim server.
 * Ensures the shim only responds to local loopback clients (127.0.0.1 / [::1] / localhost).
 */
export declare function hostIsLoopback(hostHeader: string | undefined): boolean;
export declare function originIsLoopback(originHeader: string | undefined): boolean;
