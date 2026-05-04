import type { Server } from "socket.io";

let _io: Server | null = null;

export function setIo(io: Server) { _io = io; }

export function getIo(): Server {
  if (!_io) throw new Error("Socket.io not initialized");
  return _io;
}
