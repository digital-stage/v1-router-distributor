import fetch from 'node-fetch';

export interface User {
  _id: string;
  name: string;
  email: string;
}

export function getUserByToken(token: string): Promise<User> {
  return fetch(`${process.env.AUTH_URL}/profile`, {
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    },
  })
    .then((response) => {
      if (!response.ok) {
        throw new Error(response.statusText);
      }
      return response.json();
    });
}
