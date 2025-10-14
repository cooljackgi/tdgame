
"use client";

import { useState, useEffect, useRef, useCallback } from 'react';
import { logWebRTCEvent } from '@/lib/logging';
import type { User } from 'firebase/auth';

// STUN Server Konfiguration (Google's öffentliche Server)
const iceConfiguration: RTCConfiguration = {
  iceServers: [
    { urls: ['stun:stun.l.google.com:19302', 'stun:stun1.l.google.com:19302'] },
    // 🔻 TURN eintragen (ersetzen durch deine Werte)
    ...(process.env.NEXT_PUBLIC_TURN_URL
      ? [{
          urls: process.env.NEXT_PUBLIC_TURN_URL!.split(',').map(s => s.trim()),
          username: process.env.NEXT_PUBLIC_TURN_USER || '',
          credential: process.env.NEXT_PUBLIC_TURN_CRED || '',
        } as RTCIceServer]
      : []),
  ],
  iceTransportPolicy: 'all',
};

export type NetMsg = {
    type: string;
    payload?: any;
};

export type UseWebRTCReturn = {
    lastMessage: NetMsg | null;
    sendMessage: (message: NetMsg) => void;
    isConnected: boolean; // True, wenn der DataChannel offen ist
    packetsPerSecond: number;
    bytesPerSecond: number;
    averagePacketSize: number;
};

const getSignalingUrl = (gameId: string, isMonitor: boolean): string => {
    const baseQuery = `?gameId=${encodeURIComponent(gameId)}`;
    const fullQuery = isMonitor ? `${baseQuery}&monitor=1` : baseQuery;

    // Priority 1: Use the environment variable if it's set (for production)
    const envBase = process.env.NEXT_PUBLIC_WS_BASE;
    if (envBase) {
      const baseUrl = envBase.endsWith('/ws') ? envBase.substring(0, envBase.length - 3) : envBase;
      return `${baseUrl}/ws${fullQuery}`;
    }

    // Priority 2: Fallback for local development, using the Next.js rewrite path.
    const proto = typeof window !== 'undefined' && window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const host = typeof window !== 'undefined' ? window.location.host : '';
    return `${proto}//${host}/ws${fullQuery}`;
};

export function useWebRTC(gameId: string | null, isHost: boolean, user: User | null, isMonitor: boolean = false): UseWebRTCReturn {
    const [lastMessage, setLastMessage] = useState<NetMsg | null>(null);
    const [isConnected, setIsConnected] = useState(false);
    
    // Stats state
    const [packetsPerSecond, setPacketsPerSecond] = useState(0);
    const [bytesPerSecond, setBytesPerSecond] = useState(0);
    const [averagePacketSize, setAveragePacketSize] = useState(0);

    const signalingSocketRef = useRef<WebSocket | null>(null);
    const selfIdRef = useRef<string>(globalThis.crypto?.randomUUID?.() || Math.random().toString(36).slice(2));
    const peerConnectionRef = useRef<RTCPeerConnection | null>(null);
    const dataChannelRef = useRef<RTCDataChannel | null>(null);
    const dcPingRef = useRef<NodeJS.Timeout>();

    // Refs for reconnect logic & state management inside useEffect
    const gameIdRef = useRef(gameId);
    const userRef = useRef(user);
    const isHostRef = useRef(isHost);
    const isMonitorRef = useRef(isMonitor);
    const backoffRef = useRef(0);
    const reconnectTimerRef = useRef<NodeJS.Timeout>();
    const helloIntervalRef = useRef<NodeJS.Timeout>();
    
    // Stats refs
    const packetCountRef = useRef(0);
    const byteCountRef = useRef(0);
    const statsIntervalRef = useRef<NodeJS.Timeout>();
    const periodicLogIntervalRef = useRef<NodeJS.Timeout>();

    // Update refs whenever props change, without re-triggering the main effect
    useEffect(() => { gameIdRef.current = gameId; }, [gameId]);
    useEffect(() => { userRef.current = user; }, [user]);
    useEffect(() => { isHostRef.current = isHost; }, [isHost]);
    useEffect(() => { isMonitorRef.current = isMonitor; }, [isMonitor]);

    const setupDataChannelEvents = useCallback((dc: RTCDataChannel) => {
        const currentRole = isMonitorRef.current ? 'monitor' : (isHostRef.current ? 'host' : 'client');
        const gid = gameIdRef.current;
        if (!gid) return;

        dc.onopen = () => {
            if(dcPingRef.current) clearInterval(dcPingRef.current);
            logWebRTCEvent(gid, currentRole, 'DC_OPEN');
            setIsConnected(true);
            dcPingRef.current = setInterval(() => {
              try { 
                if (dc.readyState === 'open') {
                  dc.send('{"type":"_ping"}'); 
                }
              } catch {}
            }, 5000);
        };
        dc.onclose = () => {
            if(dcPingRef.current) clearInterval(dcPingRef.current);
            dcPingRef.current = undefined;
            logWebRTCEvent(gid, currentRole, 'DC_CLOSE');
            setIsConnected(false);
        };
        dc.onmessage = (event) => {
            if (event.data === '{"type":"_ping"}') return;
            try {
                const message = JSON.parse(event.data) as NetMsg;
                setLastMessage(message);
                packetCountRef.current++;
                byteCountRef.current += event.data.length;
            } catch (error) {
                console.error('Failed to parse Data Channel message:', error);
            }
        };
    }, []);

    const createPeerConnection = useCallback(() => {
        const gid = gameIdRef.current;
        const currentRole = isMonitorRef.current ? 'monitor' : (isHostRef.current ? 'host' : 'client');
        if (!gid) return null;

        logWebRTCEvent(gid, currentRole, 'PC_CREATED');
        const pc = new RTCPeerConnection(iceConfiguration);
        
        async function logSelectedCandidatePair(pc: RTCPeerConnection) {
            const currentGid = gameIdRef.current;
            if(!currentGid) return;
            try {
                const stats = await pc.getStats();
                let selected: RTCStats | undefined;
                stats.forEach(report => { 
                    if (report.type === 'transport' && report.selectedCandidatePairId) {
                        selected = stats.get(report.selectedCandidatePairId);
                    }
                });

                if (selected && selected.type === 'candidate-pair') {
                    const local = stats.get(selected.localCandidateId);
                    const remote = stats.get(selected.remoteCandidateId);
                    logWebRTCEvent(currentGid, currentRole, 'ICE_SELECTED', {
                        local: { type: local?.candidateType, ip: local?.ip, protocol: local?.protocol },
                        remote:{ type: remote?.candidateType, ip: remote?.ip, protocol: remote?.protocol }
                    });
                }
            } catch(e) {
                console.warn("Could not get WebRTC stats", e);
            }
        }

        pc.onicecandidate = (event) => {
            if (event.candidate && signalingSocketRef.current?.readyState === WebSocket.OPEN) {
                signalingSocketRef.current.send(JSON.stringify({
                  kind: 'signal',
                  type: 'ice-candidate',
                  from: selfIdRef.current,
                  payload: event.candidate
                }));
                if (gid) logWebRTCEvent(gid, currentRole, 'PC_ICE_CANDIDATE', { candidate: event.candidate.candidate });
            }
        };
        
        pc.onconnectionstatechange = () => {
            const currentGid = gameIdRef.current;
            if (!currentGid) return;
            logWebRTCEvent(currentGid, currentRole, 'PC_CONNECTION_STATE_CHANGE', { state: pc.connectionState });
            if (pc.connectionState === 'connected') {
                // For host, isConnected is true when its own DC opens.
                // For client, this is a good indicator, but DC open is the real truth.
                if (!isHostRef.current) setIsConnected(true);
                logSelectedCandidatePair(pc);
            } else if (pc.connectionState === 'failed' || pc.connectionState === 'disconnected') {
                setIsConnected(false);
            }
        };
        
        pc.ondatachannel = (event) => {
            const dc = event.channel;
            const currentGid = gameIdRef.current;
            if (currentGid) logWebRTCEvent(currentGid, currentRole, 'DC_CREATED', { label: dc.label });
            dataChannelRef.current = dc;
            setupDataChannelEvents(dc);
        };

        return pc;
    }, [setupDataChannelEvents]);
    
    // The main, one-time-only effect
    useEffect(() => {
        let stopped = false;
        
        const connect = () => {
            if (stopped || !gameIdRef.current || !userRef.current) {
                if (!stopped) {
                  // If not ready, poll until ready
                  setTimeout(connect, 200);
                }
                return;
            }

            const gid = gameIdRef.current;
            const currentRole = isMonitorRef.current ? 'monitor' : (isHostRef.current ? 'host' : 'client');

            if (signalingSocketRef.current && signalingSocketRef.current.readyState < WebSocket.CLOSING) {
                signalingSocketRef.current.close();
            }

            const signalingUrl = getSignalingUrl(gid, isMonitorRef.current);
            logWebRTCEvent(gid, currentRole, 'SIGNALING_CONNECTING', { url: signalingUrl });
            const ws = new WebSocket(signalingUrl);
            signalingSocketRef.current = ws;

            const scheduleReconnect = () => {
              if (reconnectTimerRef.current) clearTimeout(reconnectTimerRef.current);
              if (!stopped) {
                const delay = Math.min(30000, 1000 * Math.pow(2, backoffRef.current));
                backoffRef.current++;
                logWebRTCEvent(gid, currentRole, 'SIGNALING_RECONNECT_SCHEDULED', { delay });
                reconnectTimerRef.current = setTimeout(connect, delay);
              }
            };
            
            ws.onopen = () => {
                backoffRef.current = 0;
                logWebRTCEvent(gid, currentRole, 'SIGNALING_OPEN');

                // Client starts sending "hello" periodically until an offer is received
                if (!isHostRef.current && !isMonitorRef.current) {
                    const sendHello = () => {
                       if (ws.readyState === WebSocket.OPEN) {
                         ws.send(JSON.stringify({ kind:'signal', type:'hello', from:selfIdRef.current }));
                       }
                    };
                    sendHello();
                    if(helloIntervalRef.current) clearInterval(helloIntervalRef.current);
                    helloIntervalRef.current = setInterval(sendHello, 2000);
                }
            };
            
            ws.onmessage = async (event) => {
                const msg = JSON.parse(event.data);
                if(isMonitorRef.current || (msg.from && msg.from === selfIdRef.current)) return;
                
                logWebRTCEvent(gid, currentRole, 'SIGNALING_MESSAGE_RECEIVED', { type: msg.type });

                if (!peerConnectionRef.current || peerConnectionRef.current.connectionState === 'closed') {
                    peerConnectionRef.current = createPeerConnection();
                }
                const pc = peerConnectionRef.current;
                if(!pc) return;
                
                try {
                    // Host receives "hello", creates offer
                    if (msg.type === 'hello' && isHostRef.current) {
                        if(!dataChannelRef.current || dataChannelRef.current.readyState !== 'open') {
                            const dc = pc.createDataChannel('game_data', {ordered: false, maxRetransmits: 0});
                            dataChannelRef.current = dc;
                            setupDataChannelEvents(dc);
                        }
                        const offer = await pc.createOffer({ iceRestart: true });
                        await pc.setLocalDescription(offer);
                        ws.send(JSON.stringify({ kind:'signal', type:'offer', from:selfIdRef.current, payload: pc.localDescription }));
                        logWebRTCEvent(gid, currentRole, 'PC_OFFER_CREATED_REHELLO');
                    
                    // Client receives "offer", creates answer
                    } else if (msg.type === 'offer' && !isHostRef.current) {
                        if(helloIntervalRef.current) clearInterval(helloIntervalRef.current);
                        helloIntervalRef.current = undefined;

                        await pc.setRemoteDescription(new RTCSessionDescription(msg.payload));
                        const answer = await pc.createAnswer();
                        await pc.setLocalDescription(answer);
                        if (ws.readyState === WebSocket.OPEN) {
                          ws.send(JSON.stringify({ kind:'signal', type:'answer', from:selfIdRef.current, payload: pc.localDescription }));
                        }
                    
                    // Host receives "answer"
                    } else if (msg.type === 'answer' && isHostRef.current) {
                        if (pc.signalingState !== 'stable') {
                            await pc.setRemoteDescription(new RTCSessionDescription(msg.payload));
                        }
                    
                    // Both receive ICE candidates
                    } else if (msg.type === 'ice-candidate') {
                        // Only add candidate if remote description is set
                        if (pc.remoteDescription) {
                            await pc.addIceCandidate(new RTCIceCandidate(msg.payload));
                        }
                    }
                } catch (e) {
                    console.error("Error handling signaling message:", e, msg);
                }
            };
            
            ws.onclose = (e) => {
                logWebRTCEvent(gid, currentRole, 'SIGNALING_CLOSE', { code: e.code, reason: e.reason.toString() });
                setIsConnected(false);
                if (helloIntervalRef.current) clearInterval(helloIntervalRef.current);
                scheduleReconnect();
            };

            ws.onerror = (err) => {
                logWebRTCEvent(gid, currentRole, 'SIGNALING_ERROR', { err: String(err) });
                // onclose will be called next, which will trigger reconnect
            };
        };

        connect(); // Start the connection process

        statsIntervalRef.current = setInterval(() => {
            setPacketsPerSecond(packetCountRef.current);
            setBytesPerSecond(byteCountRef.current);
            setAveragePacketSize(packetCountRef.current ? Math.round(byteCountRef.current / Math.max(1, packetCountRef.current)) : 0);
            packetCountRef.current = 0;
            byteCountRef.current = 0;
        }, 1000);

        periodicLogIntervalRef.current = setInterval(() => {
            const gid = gameIdRef.current;
            if (gid && isConnected) {
                const currentRole = isMonitorRef.current ? 'monitor' : (isHostRef.current ? 'host' : 'client');
                logWebRTCEvent(gid, currentRole, 'NET_TICK', {
                    pps: packetsPerSecond,
                    bps: bytesPerSecond,
                    avg: averagePacketSize,
                });
            }
        }, 2000); // Log stats every 2 seconds to avoid spamming Firestore

        return () => {
            stopped = true; // This is a real unmount
            if (statsIntervalRef.current) clearInterval(statsIntervalRef.current);
            if (periodicLogIntervalRef.current) clearInterval(periodicLogIntervalRef.current);
            if (dcPingRef.current) clearInterval(dcPingRef.current);
            if (reconnectTimerRef.current) clearTimeout(reconnectTimerRef.current);
            if (helloIntervalRef.current) clearInterval(helloIntervalRef.current);
            
            const ws = signalingSocketRef.current;
            if (ws) {
              ws.onclose = null; // prevent reconnect on manual close
              ws.close();
            }
            if (peerConnectionRef.current) peerConnectionRef.current.close();
        };
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []); // <-- This empty dependency array is the key to running this effect only once.

    const sendMessage = useCallback((message: NetMsg) => {
        if (isMonitorRef.current) return;
        const dc = dataChannelRef.current;
        const MAX_BUFFERED = 256 * 1024;
        if (dc?.readyState === 'open' && dc.bufferedAmount < MAX_BUFFERED) {
            try {
                const msgStr = JSON.stringify(message);
                dc.send(msgStr);
                packetCountRef.current++;
                byteCountRef.current += msgStr.length;
            } catch (e) {
                console.error("Failed to send message over data channel:", e);
            }
        }
    }, []);

    return { lastMessage, sendMessage, isConnected, packetsPerSecond, bytesPerSecond, averagePacketSize };
}
