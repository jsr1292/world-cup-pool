declare global {
  namespace App {
    interface Locals {
      user?: {
        id: number;
        username: string;
        display_name: string;
        is_admin: number;
        created_at?: string;
      };
    }
  }
}

export {};
