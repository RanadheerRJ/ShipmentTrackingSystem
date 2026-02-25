declare namespace Express {
  interface UserPayload {
    id: string;
    email: string;
    name: string;
    role: string;
    phone_number: string | null;
    address: string | null;
    organization_id: string | null;
    is_active: number;
  }

  interface Request {
    user: UserPayload;
  }
}
