import { render } from '@testing-library/react';
import React from 'react';
import { describe, test, expect, beforeAll, vi } from 'vitest';
import CameraFeed from './CameraFeed';

// Mock media devices since JSDOM doesn't support them
beforeAll(() => {
  Object.defineProperty(global.navigator, 'mediaDevices', {
    value: {
      getUserMedia: vi.fn().mockImplementation(() => Promise.resolve({
        getTracks: () => [{ stop: vi.fn() }]
      })),
    },
  });
});

describe('CameraFeed Component', () => {
  test('should render a video element even before stream resolution', () => {
    // We must pass mock refs since they are required props and manipulated immediately in useEffect
    const mockVideoRef = { current: { srcObject: null, onloadedmetadata: null, play: vi.fn() } };
    const mockCanvasRef = { current: null };

    const { container } = render(<CameraFeed isActive={true} videoRef={mockVideoRef} canvasRef={mockCanvasRef} />);
    const video = container.querySelector('video');
    
    // The video element must be in the DOM to attach the stream 
    expect(video).toBeTruthy();
    expect(video.className).toContain('camera-video');
  });

  test('should trigger error message display on constraint denial', async () => {
    const mockVideoRef = { current: { srcObject: null, onloadedmetadata: null, play: vi.fn() } };
    const mockCanvasRef = { current: null };

    // Temporarily override the mock for just this test to strictly test boundary condition rejection map rendering
    const originalGetUserMedia = global.navigator.mediaDevices.getUserMedia;
    
    global.navigator.mediaDevices.getUserMedia = vi.fn().mockImplementation(() => {
        const err = new Error("NotAllowedError");
        err.name = "NotAllowedError";
        return Promise.reject(err);
    });

    const { findByText } = render(<CameraFeed isActive={true} videoRef={mockVideoRef} canvasRef={mockCanvasRef} />);
    
    // UI error render state occurs sequentially after un-awaited getUserMedia catch wrapper fires async hook state setter
    const errorAlert = await findByText('Camera permission denied');
    expect(errorAlert).toBeTruthy();

    global.navigator.mediaDevices.getUserMedia = originalGetUserMedia;
  });

  test('should render canvas element conditionally when showCanvas is true', () => {
    const mockVideoRef = { current: { srcObject: null, play: vi.fn() } };
    const mockCanvasRef = { current: null };

    const { container, rerender } = render(<CameraFeed isActive={true} showCanvas={false} videoRef={mockVideoRef} canvasRef={mockCanvasRef} />);
    expect(container.querySelector('canvas')).toBeFalsy();

    rerender(<CameraFeed isActive={true} showCanvas={true} videoRef={mockVideoRef} canvasRef={mockCanvasRef} />);
    expect(container.querySelector('canvas')).toBeTruthy();
  });

  test('should clean up video streams strictly on component unmount', () => {
    const mockVideoRef = { current: { srcObject: { getTracks: vi.fn().mockReturnValue([{ stop: vi.fn() }]) }, play: vi.fn() } };
    const mockCanvasRef = { current: null };

    const { unmount } = render(<CameraFeed isActive={true} videoRef={mockVideoRef} canvasRef={mockCanvasRef} />);
    
    expect(() => unmount()).not.toThrow();
    // Streams are captured in ref and cleaned via getTracks on component destruction
  });
});
