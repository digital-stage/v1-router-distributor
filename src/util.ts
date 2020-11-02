import * as socketIO from 'socket.io';
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

export function authorizeSocket(socket: socketIO.Socket): Promise<User> {
  if (!socket.handshake.query || !socket.handshake.query.token) {
    throw new Error('Missing authorization');
  }
  return this.getUserByToken(socket.handshake.query.token);
}
